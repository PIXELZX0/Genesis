#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/live-docker-auth.sh"
IMAGE_NAME="${GENESIS_IMAGE:-genesis:local}"
LIVE_IMAGE_NAME="${GENESIS_LIVE_IMAGE:-${IMAGE_NAME}-live}"
PROFILE_FILE="${GENESIS_PROFILE_FILE:-$HOME/.profile}"
DOCKER_USER="${GENESIS_DOCKER_USER:-node}"
DOCKER_AUTH_PRESTAGED=0

genesis_live_truthy() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES | on | ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

TEMP_DIRS=()
DOCKER_HOME_MOUNT=()
cleanup_temp_dirs() {
  if ((${#TEMP_DIRS[@]} > 0)); then
    rm -rf "${TEMP_DIRS[@]}"
  fi
}
trap cleanup_temp_dirs EXIT

if genesis_live_truthy "${GENESIS_DOCKER_PROFILE_ENV_ONLY:-}"; then
  CONFIG_DIR="$(mktemp -d)"
  WORKSPACE_DIR="$(mktemp -d)"
  TEMP_DIRS+=("$CONFIG_DIR" "$WORKSPACE_DIR")
  GENESIS_DOCKER_AUTH_DIRS=none
else
  CONFIG_DIR="${GENESIS_CONFIG_DIR:-$HOME/.genesis}"
  WORKSPACE_DIR="${GENESIS_WORKSPACE_DIR:-$HOME/.genesis/workspace}"
fi
if [[ -n "${GENESIS_DOCKER_CACHE_HOME_DIR:-}" ]]; then
  CACHE_HOME_DIR="${GENESIS_DOCKER_CACHE_HOME_DIR}"
elif [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  CACHE_HOME_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/genesis-docker-cache.XXXXXX")"
  TEMP_DIRS+=("$CACHE_HOME_DIR")
else
  CACHE_HOME_DIR="$HOME/.cache/genesis/docker-cache"
fi
mkdir -p "$CACHE_HOME_DIR"
if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  DOCKER_USER="$(id -u):$(id -g)"
  DOCKER_HOME_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/genesis-docker-home.XXXXXX")"
  TEMP_DIRS+=("$DOCKER_HOME_DIR")
  DOCKER_HOME_MOUNT=(-v "$DOCKER_HOME_DIR":/home/node)
fi

PROFILE_MOUNT=()
PROFILE_STATUS="none"
if [[ -f "$PROFILE_FILE" && -r "$PROFILE_FILE" ]]; then
  PROFILE_MOUNT=(-v "$PROFILE_FILE":/home/node/.profile:ro)
  PROFILE_STATUS="$PROFILE_FILE"
fi

AUTH_DIRS=()
AUTH_FILES=()
if [[ -n "${GENESIS_DOCKER_AUTH_DIRS:-}" ]]; then
  while IFS= read -r auth_dir; do
    [[ -n "$auth_dir" ]] || continue
    AUTH_DIRS+=("$auth_dir")
  done < <(genesis_live_collect_auth_dirs)
  while IFS= read -r auth_file; do
    [[ -n "$auth_file" ]] || continue
    AUTH_FILES+=("$auth_file")
  done < <(genesis_live_collect_auth_files)
elif [[ -n "${GENESIS_LIVE_PROVIDERS:-}" || -n "${GENESIS_LIVE_GATEWAY_PROVIDERS:-}" ]]; then
  while IFS= read -r auth_dir; do
    [[ -n "$auth_dir" ]] || continue
    AUTH_DIRS+=("$auth_dir")
  done < <(
    {
      genesis_live_collect_auth_dirs_from_csv "${GENESIS_LIVE_PROVIDERS:-}"
      genesis_live_collect_auth_dirs_from_csv "${GENESIS_LIVE_GATEWAY_PROVIDERS:-}"
    } | awk '!seen[$0]++'
  )
  while IFS= read -r auth_file; do
    [[ -n "$auth_file" ]] || continue
    AUTH_FILES+=("$auth_file")
  done < <(
    {
      genesis_live_collect_auth_files_from_csv "${GENESIS_LIVE_PROVIDERS:-}"
      genesis_live_collect_auth_files_from_csv "${GENESIS_LIVE_GATEWAY_PROVIDERS:-}"
    } | awk '!seen[$0]++'
  )
else
  while IFS= read -r auth_dir; do
    [[ -n "$auth_dir" ]] || continue
    AUTH_DIRS+=("$auth_dir")
  done < <(genesis_live_collect_auth_dirs)
  while IFS= read -r auth_file; do
    [[ -n "$auth_file" ]] || continue
    AUTH_FILES+=("$auth_file")
  done < <(genesis_live_collect_auth_files)
fi
AUTH_DIRS_CSV=""
if ((${#AUTH_DIRS[@]} > 0)); then
  AUTH_DIRS_CSV="$(genesis_live_join_csv "${AUTH_DIRS[@]}")"
fi
AUTH_FILES_CSV=""
if ((${#AUTH_FILES[@]} > 0)); then
  AUTH_FILES_CSV="$(genesis_live_join_csv "${AUTH_FILES[@]}")"
fi

if [[ -n "${DOCKER_HOME_DIR:-}" ]]; then
  genesis_live_stage_auth_into_home "$DOCKER_HOME_DIR" "${AUTH_DIRS[@]}" --files "${AUTH_FILES[@]}"
  DOCKER_AUTH_PRESTAGED=1
fi

EXTERNAL_AUTH_MOUNTS=()
if ((${#AUTH_DIRS[@]} > 0)); then
  for auth_dir in "${AUTH_DIRS[@]}"; do
    auth_dir="$(genesis_live_validate_relative_home_path "$auth_dir")"
    host_path="$HOME/$auth_dir"
    if [[ -d "$host_path" ]]; then
      EXTERNAL_AUTH_MOUNTS+=(-v "$host_path":/host-auth/"$auth_dir":ro)
    fi
  done
fi
if ((${#AUTH_FILES[@]} > 0)); then
  for auth_file in "${AUTH_FILES[@]}"; do
    auth_file="$(genesis_live_validate_relative_home_path "$auth_file")"
    host_path="$HOME/$auth_file"
    if [[ -f "$host_path" ]]; then
      EXTERNAL_AUTH_MOUNTS+=(-v "$host_path":/host-auth-files/"$auth_file":ro)
    fi
  done
fi

read -r -d '' LIVE_TEST_CMD <<'EOF' || true
set -euo pipefail
[ -f "$HOME/.profile" ] && [ -r "$HOME/.profile" ] && source "$HOME/.profile" || true
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export COREPACK_HOME="${COREPACK_HOME:-$XDG_CACHE_HOME/node/corepack}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-$XDG_CACHE_HOME/npm}"
export npm_config_cache="$NPM_CONFIG_CACHE"
mkdir -p "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE"
chmod 700 "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE" || true
if [ "${GENESIS_DOCKER_AUTH_PRESTAGED:-0}" != "1" ]; then
  IFS=',' read -r -a auth_dirs <<<"${GENESIS_DOCKER_AUTH_DIRS_RESOLVED:-}"
  IFS=',' read -r -a auth_files <<<"${GENESIS_DOCKER_AUTH_FILES_RESOLVED:-}"
  if ((${#auth_dirs[@]} > 0)); then
    for auth_dir in "${auth_dirs[@]}"; do
      [ -n "$auth_dir" ] || continue
      if [ -d "/host-auth/$auth_dir" ]; then
        mkdir -p "$HOME/$auth_dir"
        cp -R "/host-auth/$auth_dir/." "$HOME/$auth_dir"
        chmod -R u+rwX "$HOME/$auth_dir" || true
      fi
    done
  fi
  if ((${#auth_files[@]} > 0)); then
    for auth_file in "${auth_files[@]}"; do
      [ -n "$auth_file" ] || continue
      if [ -f "/host-auth-files/$auth_file" ]; then
        mkdir -p "$(dirname "$HOME/$auth_file")"
        cp "/host-auth-files/$auth_file" "$HOME/$auth_file"
        chmod u+rw "$HOME/$auth_file" || true
      fi
    done
  fi
fi
tmp_dir="$(mktemp -d)"
source /src/scripts/lib/live-docker-stage.sh
genesis_live_stage_source_tree "$tmp_dir"
genesis_live_stage_node_modules "$tmp_dir"
genesis_live_link_runtime_tree "$tmp_dir"
genesis_live_stage_state_dir "$tmp_dir/.genesis-state"
genesis_live_prepare_staged_config
cd "$tmp_dir"
pnpm test:live:models-profiles
EOF

"$ROOT_DIR/scripts/test-live-build-docker.sh"

echo "==> Run live model tests (profile keys)"
echo "==> Target: src/agents/models.profiles.live.test.ts"
echo "==> Profile env only: ${GENESIS_DOCKER_PROFILE_ENV_ONLY:-0}"
echo "==> Profile file: $PROFILE_STATUS"
echo "==> External auth dirs: ${AUTH_DIRS_CSV:-none}"
echo "==> External auth files: ${AUTH_FILES_CSV:-none}"
DOCKER_RUN_ARGS=(docker run --rm -t \
  -u "$DOCKER_USER" \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e GENESIS_SKIP_CHANNELS=1 \
  -e GENESIS_SUPPRESS_NOTES=1 \
  -e GENESIS_DOCKER_AUTH_PRESTAGED="$DOCKER_AUTH_PRESTAGED" \
  -e GENESIS_DOCKER_AUTH_DIRS_RESOLVED="$AUTH_DIRS_CSV" \
  -e GENESIS_DOCKER_AUTH_FILES_RESOLVED="$AUTH_FILES_CSV" \
  -e GENESIS_LIVE_DOCKER_SOURCE_STAGE_MODE="${GENESIS_LIVE_DOCKER_SOURCE_STAGE_MODE:-copy}" \
  -e GENESIS_LIVE_TEST=1 \
  -e GENESIS_LIVE_MODELS="${GENESIS_LIVE_MODELS:-modern}" \
  -e GENESIS_LIVE_PROVIDERS="${GENESIS_LIVE_PROVIDERS:-}" \
  -e GENESIS_LIVE_MAX_MODELS="${GENESIS_LIVE_MAX_MODELS:-12}" \
  -e GENESIS_LIVE_MODEL_TIMEOUT_MS="${GENESIS_LIVE_MODEL_TIMEOUT_MS:-}" \
  -e GENESIS_LIVE_REQUIRE_PROFILE_KEYS="${GENESIS_LIVE_REQUIRE_PROFILE_KEYS:-}" \
  -e GENESIS_LIVE_GATEWAY_MODELS="${GENESIS_LIVE_GATEWAY_MODELS:-}" \
  -e GENESIS_LIVE_GATEWAY_PROVIDERS="${GENESIS_LIVE_GATEWAY_PROVIDERS:-}" \
  -e GENESIS_LIVE_GATEWAY_MAX_MODELS="${GENESIS_LIVE_GATEWAY_MAX_MODELS:-}")
genesis_live_append_array DOCKER_RUN_ARGS DOCKER_HOME_MOUNT
DOCKER_RUN_ARGS+=(\
  -v "$CACHE_HOME_DIR":/home/node/.cache \
  -v "$ROOT_DIR":/src:ro \
  -v "$CONFIG_DIR":/home/node/.genesis \
  -v "$WORKSPACE_DIR":/home/node/.genesis/workspace)
genesis_live_append_array DOCKER_RUN_ARGS EXTERNAL_AUTH_MOUNTS
genesis_live_append_array DOCKER_RUN_ARGS PROFILE_MOUNT
DOCKER_RUN_ARGS+=(\
  "$LIVE_IMAGE_NAME" \
  -lc "$LIVE_TEST_CMD")
"${DOCKER_RUN_ARGS[@]}"
