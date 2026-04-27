#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/live-docker-auth.sh"
IMAGE_NAME="${GENESIS_IMAGE:-genesis:local}"
LIVE_IMAGE_NAME="${GENESIS_LIVE_IMAGE:-${IMAGE_NAME}-live}"
CONFIG_DIR="${GENESIS_CONFIG_DIR:-$HOME/.genesis}"
WORKSPACE_DIR="${GENESIS_WORKSPACE_DIR:-$HOME/.genesis/workspace}"
PROFILE_FILE="${GENESIS_PROFILE_FILE:-$HOME/.profile}"
DEFAULT_PROVIDER="${GENESIS_DOCKER_CLI_BACKEND_PROVIDER:-claude-cli}"
CLI_MODEL="${GENESIS_LIVE_CLI_BACKEND_MODEL:-}"
CLI_PROVIDER="${CLI_MODEL%%/*}"
CLI_DISABLE_MCP_CONFIG="${GENESIS_LIVE_CLI_BACKEND_DISABLE_MCP_CONFIG:-}"
CLI_AUTH_MODE="${GENESIS_LIVE_CLI_BACKEND_AUTH:-auto}"
TEMP_DIRS=()
DOCKER_USER="${GENESIS_DOCKER_USER:-node}"
DOCKER_HOME_MOUNT=()
DOCKER_EXTRA_ENV_FILES=()
DOCKER_AUTH_PRESTAGED=0

if [[ -z "$CLI_PROVIDER" || "$CLI_PROVIDER" == "$CLI_MODEL" ]]; then
  CLI_PROVIDER="$DEFAULT_PROVIDER"
fi
CLI_USE_CI_SAFE_CODEX_CONFIG="${GENESIS_LIVE_CLI_BACKEND_USE_CI_SAFE_CODEX_CONFIG:-}"
if [[ -z "$CLI_USE_CI_SAFE_CODEX_CONFIG" ]]; then
  if [[ "$CLI_PROVIDER" == "codex-cli" ]]; then
    CLI_USE_CI_SAFE_CODEX_CONFIG="1"
  else
    CLI_USE_CI_SAFE_CODEX_CONFIG="0"
  fi
fi

case "$CLI_AUTH_MODE" in
  auto | api-key | subscription)
    ;;
  *)
    echo "ERROR: GENESIS_LIVE_CLI_BACKEND_AUTH must be one of: auto, api-key, subscription." >&2
    exit 1
    ;;
esac

if [[ "$CLI_AUTH_MODE" == "subscription" && "$CLI_PROVIDER" != "claude-cli" ]]; then
  echo "ERROR: GENESIS_LIVE_CLI_BACKEND_AUTH=subscription is only supported for claude-cli." >&2
  exit 1
fi

if [[ "$CLI_AUTH_MODE" == "api-key" && "$CLI_PROVIDER" == "codex-cli" ]]; then
  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    echo "ERROR: GENESIS_LIVE_CLI_BACKEND_AUTH=api-key for codex-cli requires OPENAI_API_KEY." >&2
    exit 1
  fi
fi

CLI_METADATA_JSON="$(node --import tsx "$ROOT_DIR/scripts/print-cli-backend-live-metadata.ts" "$CLI_PROVIDER")"
read_metadata_field() {
  local field="$1"
  node -e 'const data = JSON.parse(process.argv[1]); const field = process.argv[2]; const value = data?.[field]; if (value == null) process.exit(1); process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));' \
    "$CLI_METADATA_JSON" \
    "$field"
}

DEFAULT_MODEL="$(read_metadata_field defaultModelRef 2>/dev/null || printf '%s' 'claude-cli/claude-sonnet-4-6')"
CLI_MODEL="${CLI_MODEL:-$DEFAULT_MODEL}"
CLI_DEFAULT_COMMAND="$(read_metadata_field command 2>/dev/null || true)"
CLI_DOCKER_NPM_PACKAGE="$(read_metadata_field dockerNpmPackage 2>/dev/null || true)"
CLI_DOCKER_BINARY_NAME="$(read_metadata_field dockerBinaryName 2>/dev/null || true)"

if [[ "$CLI_PROVIDER" == "claude-cli" && -z "$CLI_DISABLE_MCP_CONFIG" ]]; then
  if [[ "$CLI_AUTH_MODE" == "subscription" ]]; then
    CLI_DISABLE_MCP_CONFIG="1"
  else
    CLI_DISABLE_MCP_CONFIG="0"
  fi
fi
export GENESIS_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE="${GENESIS_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE:-0}"
export GENESIS_LIVE_CLI_BACKEND_IMAGE_PROBE="${GENESIS_LIVE_CLI_BACKEND_IMAGE_PROBE:-0}"
export GENESIS_LIVE_CLI_BACKEND_MCP_PROBE="${GENESIS_LIVE_CLI_BACKEND_MCP_PROBE:-0}"

cleanup_temp_dirs() {
  if ((${#TEMP_DIRS[@]} > 0)); then
    rm -rf "${TEMP_DIRS[@]}"
  fi
}
trap cleanup_temp_dirs EXIT

if [[ -n "${GENESIS_DOCKER_CLI_TOOLS_DIR:-}" ]]; then
  CLI_TOOLS_DIR="${GENESIS_DOCKER_CLI_TOOLS_DIR}"
elif [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  CLI_TOOLS_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/genesis-docker-cli-tools.XXXXXX")"
  TEMP_DIRS+=("$CLI_TOOLS_DIR")
else
  CLI_TOOLS_DIR="$HOME/.cache/genesis/docker-cli-tools"
fi
if [[ -n "${GENESIS_DOCKER_CACHE_HOME_DIR:-}" ]]; then
  CACHE_HOME_DIR="${GENESIS_DOCKER_CACHE_HOME_DIR}"
elif [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  CACHE_HOME_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/genesis-docker-cache.XXXXXX")"
  TEMP_DIRS+=("$CACHE_HOME_DIR")
else
  CACHE_HOME_DIR="$HOME/.cache/genesis/docker-cache"
fi

mkdir -p "$CLI_TOOLS_DIR"
mkdir -p "$CACHE_HOME_DIR"
if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  DOCKER_USER="$(id -u):$(id -g)"
  DOCKER_HOME_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/genesis-docker-home.XXXXXX")"
  TEMP_DIRS+=("$DOCKER_HOME_DIR")
  DOCKER_HOME_MOUNT=(-v "$DOCKER_HOME_DIR":/home/node)
fi

if [[ "$CLI_PROVIDER" == "claude-cli" && "$CLI_AUTH_MODE" == "subscription" ]]; then
  CLAUDE_CREDS_FILE="$HOME/.claude/.credentials.json"
  CLAUDE_SUBSCRIPTION_AUTH_SOURCE=""
  CLAUDE_SUBSCRIPTION_TYPE=""
  if [[ -f "$CLAUDE_CREDS_FILE" ]]; then
    CLAUDE_SUBSCRIPTION_TYPE="$(
      node -e '
        const fs = require("node:fs");
        const file = process.argv[1];
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        const subscriptionType = String(data?.claudeAiOauth?.subscriptionType ?? "").trim();
        if (!subscriptionType || subscriptionType === "unknown") process.exit(2);
        process.stdout.write(subscriptionType);
      ' "$CLAUDE_CREDS_FILE" 2>/dev/null
    )" || {
      echo "ERROR: $CLAUDE_CREDS_FILE does not look like Claude subscription OAuth auth." >&2
      echo "Expected claudeAiOauth.subscriptionType to be present." >&2
      exit 1
    }
    CLAUDE_SUBSCRIPTION_AUTH_SOURCE="credentials-file"
  elif [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
    CLAUDE_SUBSCRIPTION_TYPE="oauth-token"
    CLAUDE_SUBSCRIPTION_AUTH_SOURCE="env-token"
  else
    echo "ERROR: Claude subscription auth requires either:" >&2
    echo "  - $CLAUDE_CREDS_FILE with claudeAiOauth.subscriptionType, or" >&2
    echo "  - CLAUDE_CODE_OAUTH_TOKEN from 'claude setup-token'." >&2
    exit 1
  fi
  if [[ -z "${GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV:-}" ]]; then
    if [[ "$CLAUDE_SUBSCRIPTION_AUTH_SOURCE" == "env-token" ]]; then
      export GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV='["CLAUDE_CODE_OAUTH_TOKEN"]'
    else
      export GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV="[]"
    fi
  fi
  if [[ "$GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV" == *ANTHROPIC_API_KEY* ]]; then
    echo "ERROR: subscription auth smoke must not preserve Anthropic API-key env vars." >&2
    exit 1
  fi
  if [[ "$CLAUDE_SUBSCRIPTION_AUTH_SOURCE" == "env-token" && "$GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV" != *CLAUDE_CODE_OAUTH_TOKEN* ]]; then
    echo "ERROR: CLAUDE_CODE_OAUTH_TOKEN subscription smoke must preserve CLAUDE_CODE_OAUTH_TOKEN for the Gateway child process." >&2
    exit 1
  fi
  export GENESIS_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE="${GENESIS_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE:-0}"
  export GENESIS_LIVE_CLI_BACKEND_RESUME_PROBE="${GENESIS_LIVE_CLI_BACKEND_RESUME_PROBE:-1}"
  export GENESIS_LIVE_CLI_BACKEND_IMAGE_PROBE="${GENESIS_LIVE_CLI_BACKEND_IMAGE_PROBE:-0}"
  export GENESIS_LIVE_CLI_BACKEND_MCP_PROBE="${GENESIS_LIVE_CLI_BACKEND_MCP_PROBE:-0}"
fi

PROFILE_MOUNT=()
PROFILE_STATUS="none"
if [[ -f "$PROFILE_FILE" && -r "$PROFILE_FILE" ]]; then
  PROFILE_MOUNT=(-v "$PROFILE_FILE":/home/node/.profile:ro)
  PROFILE_STATUS="$PROFILE_FILE"
fi

AUTH_DIRS=()
AUTH_FILES=()
if [[ "$CLI_AUTH_MODE" == "api-key" && "$CLI_PROVIDER" == "codex-cli" ]]; then
  AUTH_FILES+=(".codex/config.toml")
elif [[ -n "${GENESIS_DOCKER_AUTH_DIRS:-}" ]]; then
  while IFS= read -r auth_dir; do
    [[ -n "$auth_dir" ]] || continue
    AUTH_DIRS+=("$auth_dir")
  done < <(genesis_live_collect_auth_dirs)
  while IFS= read -r auth_file; do
    [[ -n "$auth_file" ]] || continue
    AUTH_FILES+=("$auth_file")
  done < <(genesis_live_collect_auth_files)
else
  while IFS= read -r auth_dir; do
    [[ -n "$auth_dir" ]] || continue
    AUTH_DIRS+=("$auth_dir")
  done < <(genesis_live_collect_auth_dirs_from_csv "$CLI_PROVIDER")
  while IFS= read -r auth_file; do
    [[ -n "$auth_file" ]] || continue
    AUTH_FILES+=("$auth_file")
  done < <(genesis_live_collect_auth_files_from_csv "$CLI_PROVIDER")
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
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"
export npm_config_prefix="$NPM_CONFIG_PREFIX"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export COREPACK_HOME="${COREPACK_HOME:-$XDG_CACHE_HOME/node/corepack}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-$XDG_CACHE_HOME/npm}"
export npm_config_cache="$NPM_CONFIG_CACHE"
mkdir -p "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE"
chmod 700 "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE" || true
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
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
provider="${GENESIS_DOCKER_CLI_BACKEND_PROVIDER:-claude-cli}"
default_command="${GENESIS_DOCKER_CLI_BACKEND_COMMAND_DEFAULT:-}"
docker_package="${GENESIS_DOCKER_CLI_BACKEND_NPM_PACKAGE:-}"
binary_name="${GENESIS_DOCKER_CLI_BACKEND_BINARY_NAME:-}"
if [ "$provider" = "codex-cli" ] && [ "${GENESIS_LIVE_CLI_BACKEND_AUTH:-auto}" != "api-key" ]; then
  unset OPENAI_API_KEY
  unset OPENAI_BASE_URL
fi
if [ -z "$binary_name" ] && [ -n "$default_command" ]; then
  binary_name="$(basename "$default_command")"
fi
if [ -z "${GENESIS_LIVE_CLI_BACKEND_COMMAND:-}" ] && [ -n "$binary_name" ]; then
  export GENESIS_LIVE_CLI_BACKEND_COMMAND="$NPM_CONFIG_PREFIX/bin/$binary_name"
fi
package_has_explicit_version() {
  case "$1" in
    @*/*@*) return 0 ;;
    *@*)
      [[ "$1" != @* ]]
      return
      ;;
    *) return 1 ;;
  esac
}
if [ -n "${GENESIS_LIVE_CLI_BACKEND_COMMAND:-}" ] && [ ! -x "${GENESIS_LIVE_CLI_BACKEND_COMMAND}" ] && [ -n "$docker_package" ]; then
  npm install -g "$docker_package"
elif [ -n "$docker_package" ] && package_has_explicit_version "$docker_package"; then
  npm install -g "$docker_package"
fi
if [ "$provider" = "codex-cli" ] && [ "${GENESIS_LIVE_CLI_BACKEND_AUTH:-auto}" = "api-key" ]; then
  codex_login_command="${GENESIS_LIVE_CLI_BACKEND_COMMAND:-$NPM_CONFIG_PREFIX/bin/codex}"
  if [ ! -x "$codex_login_command" ] && [ -x "$NPM_CONFIG_PREFIX/bin/codex" ]; then
    codex_login_command="$NPM_CONFIG_PREFIX/bin/codex"
  fi
  printf '%s\n' "$OPENAI_API_KEY" | "$codex_login_command" login --with-api-key >/dev/null
fi
if [ -n "${GENESIS_LIVE_CLI_BACKEND_COMMAND:-}" ] && [ -x "${GENESIS_LIVE_CLI_BACKEND_COMMAND}" ]; then
  echo "==> CLI backend binary: ${GENESIS_LIVE_CLI_BACKEND_COMMAND}"
  "${GENESIS_LIVE_CLI_BACKEND_COMMAND}" -V || "${GENESIS_LIVE_CLI_BACKEND_COMMAND}" --version || true
fi
if [ "$provider" = "claude-cli" ]; then
  auth_mode="${GENESIS_LIVE_CLI_BACKEND_AUTH:-auto}"
  if [ "$auth_mode" = "subscription" ]; then
    unset ANTHROPIC_API_KEY
    unset ANTHROPIC_API_KEY_OLD
    unset ANTHROPIC_API_TOKEN
    unset ANTHROPIC_AUTH_TOKEN
    unset ANTHROPIC_OAUTH_TOKEN
    node - <<'NODE'
const fs = require("node:fs");
const file = `${process.env.HOME}/.claude/.credentials.json`;
if (fs.existsSync(file)) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const subscriptionType = String(data?.claudeAiOauth?.subscriptionType ?? "").trim();
  if (!subscriptionType || subscriptionType === "unknown") {
    throw new Error("Claude subscription OAuth credentials are missing subscriptionType.");
  }
  console.error(`[claude-subscription] subscriptionType=${subscriptionType}`);
} else if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
  console.error("[claude-subscription] using CLAUDE_CODE_OAUTH_TOKEN from environment");
} else {
  throw new Error("Claude subscription OAuth token or credentials file is required.");
}
NODE
  fi
  real_claude="$NPM_CONFIG_PREFIX/bin/claude-real"
  if [ ! -x "$real_claude" ] && [ -x "$NPM_CONFIG_PREFIX/bin/claude" ]; then
    mv "$NPM_CONFIG_PREFIX/bin/claude" "$real_claude"
  fi
  if [ -x "$real_claude" ]; then
    cat > "$NPM_CONFIG_PREFIX/bin/claude" <<WRAP
#!/usr/bin/env bash
script_dir="\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)"
if [ -n "\${GENESIS_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY:-}" ]; then
  export ANTHROPIC_API_KEY="\${GENESIS_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY}"
fi
if [ -n "\${GENESIS_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY_OLD:-}" ]; then
  export ANTHROPIC_API_KEY_OLD="\${GENESIS_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY_OLD}"
fi
exec "\$script_dir/claude-real" "\$@"
WRAP
    chmod +x "$NPM_CONFIG_PREFIX/bin/claude"
  fi
  if [ -z "${GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV:-}" ]; then
    export GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV='["ANTHROPIC_API_KEY","ANTHROPIC_API_KEY_OLD"]'
  fi
  if [ "$auth_mode" = "subscription" ]; then
    claude --version
    direct_token="GENESIS-CLAUDE-SUBSCRIPTION-DIRECT"
    direct_output="$(
      claude \
        -p "Reply exactly: $direct_token" \
        --output-format text \
        --model sonnet \
        --permission-mode bypassPermissions \
        --setting-sources user \
        --strict-mcp-config \
        --mcp-config '{"mcpServers":{}}' \
        --no-session-persistence
    )"
    if [[ "$direct_output" != *"$direct_token"* ]]; then
      echo "ERROR: direct Claude subscription probe did not return expected token." >&2
      echo "$direct_output" >&2
      exit 1
    fi
    echo "[claude-subscription] direct claude -p probe ok"
  else
    claude auth status || true
  fi
fi
tmp_dir="$(mktemp -d)"
source /src/scripts/lib/live-docker-stage.sh
genesis_live_stage_source_tree "$tmp_dir"
# Use a writable node_modules overlay in the temp repo. Vite writes bundled
# config artifacts under the nearest node_modules/.vite-temp path, and the
# build-stage /app/node_modules tree is root-owned in this Docker lane.
genesis_live_stage_node_modules "$tmp_dir"
genesis_live_link_runtime_tree "$tmp_dir"
genesis_live_stage_state_dir "$tmp_dir/.genesis-state"
genesis_live_prepare_staged_config
cd "$tmp_dir"
if [ "${GENESIS_LIVE_CLI_BACKEND_USE_CI_SAFE_CODEX_CONFIG:-0}" = "1" ]; then
  node --import tsx /src/scripts/prepare-codex-ci-config.ts "$HOME/.codex/config.toml" "$tmp_dir"
fi
pnpm test:live src/gateway/gateway-cli-backend.live.test.ts
EOF

if [[ "${GENESIS_SKIP_DOCKER_BUILD:-}" == "1" ]]; then
  echo "==> Reuse live-test image: $LIVE_IMAGE_NAME (GENESIS_SKIP_DOCKER_BUILD=1)"
else
  "$ROOT_DIR/scripts/test-live-build-docker.sh"
fi

echo "==> Run CLI backend live test in Docker"
echo "==> Model: $CLI_MODEL"
echo "==> Provider: $CLI_PROVIDER"
echo "==> Auth mode: $CLI_AUTH_MODE"
echo "==> Profile file: $PROFILE_STATUS"
if [[ "$CLI_PROVIDER" == "codex-cli" ]]; then
  echo "==> CI-safe Codex config: $CLI_USE_CI_SAFE_CODEX_CONFIG"
fi
if [[ "$CLI_PROVIDER" == "claude-cli" && "$CLI_AUTH_MODE" == "subscription" ]]; then
  echo "==> Claude subscription: $CLAUDE_SUBSCRIPTION_TYPE"
  echo "==> Claude subscription source: $CLAUDE_SUBSCRIPTION_AUTH_SOURCE"
fi
echo "==> External auth dirs: ${AUTH_DIRS_CSV:-none}"
echo "==> External auth files: ${AUTH_FILES_CSV:-none}"
DOCKER_AUTH_ENV=(
  -e GENESIS_LIVE_CLI_BACKEND_AUTH="$CLI_AUTH_MODE"
)
if [[ "$CLI_PROVIDER" == "codex-cli" && "$CLI_AUTH_MODE" == "api-key" ]]; then
  docker_env_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/genesis-cli-backend-env.XXXXXX")"
  TEMP_DIRS+=("$docker_env_dir")
  docker_env_file="$docker_env_dir/openai.env"
  {
    printf 'OPENAI_API_KEY=%s\n' "${OPENAI_API_KEY}"
    if [[ -n "${OPENAI_BASE_URL:-}" ]]; then
      printf 'OPENAI_BASE_URL=%s\n' "${OPENAI_BASE_URL}"
    fi
  } >"$docker_env_file"
  DOCKER_EXTRA_ENV_FILES+=(--env-file "$docker_env_file")
elif [[ "$CLI_PROVIDER" == "claude-cli" && "$CLI_AUTH_MODE" == "subscription" ]]; then
  DOCKER_AUTH_ENV+=(
    -e CLAUDE_CODE_OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
    -e GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV="$GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV"
  )
else
  DOCKER_AUTH_ENV+=(
    -e ANTHROPIC_API_KEY
    -e ANTHROPIC_API_KEY_OLD
    -e GENESIS_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
    -e GENESIS_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY_OLD="${ANTHROPIC_API_KEY_OLD:-}"
    -e GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV="${GENESIS_LIVE_CLI_BACKEND_PRESERVE_ENV:-}"
  )
fi

DOCKER_RUN_ARGS=(docker run --rm -t \
  -u "$DOCKER_USER" \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e GENESIS_SKIP_CHANNELS=1 \
  -e GENESIS_VITEST_FS_MODULE_CACHE=0 \
  -e GENESIS_DOCKER_AUTH_PRESTAGED="$DOCKER_AUTH_PRESTAGED" \
  -e GENESIS_DOCKER_AUTH_DIRS_RESOLVED="$AUTH_DIRS_CSV" \
  -e GENESIS_DOCKER_AUTH_FILES_RESOLVED="$AUTH_FILES_CSV" \
  -e GENESIS_LIVE_DOCKER_SOURCE_STAGE_MODE="${GENESIS_LIVE_DOCKER_SOURCE_STAGE_MODE:-copy}" \
  -e GENESIS_LIVE_CLI_BACKEND_USE_CI_SAFE_CODEX_CONFIG="$CLI_USE_CI_SAFE_CODEX_CONFIG" \
  -e GENESIS_DOCKER_CLI_BACKEND_PROVIDER="$CLI_PROVIDER" \
  -e GENESIS_DOCKER_CLI_BACKEND_COMMAND_DEFAULT="$CLI_DEFAULT_COMMAND" \
  -e GENESIS_DOCKER_CLI_BACKEND_NPM_PACKAGE="$CLI_DOCKER_NPM_PACKAGE" \
  -e GENESIS_DOCKER_CLI_BACKEND_BINARY_NAME="$CLI_DOCKER_BINARY_NAME" \
  -e GENESIS_LIVE_TEST=1 \
  -e GENESIS_LIVE_CLI_BACKEND=1 \
  -e GENESIS_LIVE_CLI_BACKEND_DEBUG="${GENESIS_LIVE_CLI_BACKEND_DEBUG:-}" \
  -e GENESIS_CLI_BACKEND_LOG_OUTPUT="${GENESIS_CLI_BACKEND_LOG_OUTPUT:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_MODEL="$CLI_MODEL" \
  -e GENESIS_LIVE_CLI_BACKEND_COMMAND="${GENESIS_LIVE_CLI_BACKEND_COMMAND:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_ARGS="${GENESIS_LIVE_CLI_BACKEND_ARGS:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_RESUME_ARGS="${GENESIS_LIVE_CLI_BACKEND_RESUME_ARGS:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_CLEAR_ENV="${GENESIS_LIVE_CLI_BACKEND_CLEAR_ENV:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_DISABLE_MCP_CONFIG="$CLI_DISABLE_MCP_CONFIG" \
  -e GENESIS_LIVE_CLI_BACKEND_RESUME_PROBE="${GENESIS_LIVE_CLI_BACKEND_RESUME_PROBE:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE="${GENESIS_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_IMAGE_PROBE="${GENESIS_LIVE_CLI_BACKEND_IMAGE_PROBE:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_MCP_PROBE="${GENESIS_LIVE_CLI_BACKEND_MCP_PROBE:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_MCP_SCHEMA_PROBE="${GENESIS_LIVE_CLI_BACKEND_MCP_SCHEMA_PROBE:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_IMAGE_ARG="${GENESIS_LIVE_CLI_BACKEND_IMAGE_ARG:-}" \
  -e GENESIS_LIVE_CLI_BACKEND_IMAGE_MODE="${GENESIS_LIVE_CLI_BACKEND_IMAGE_MODE:-}")
genesis_live_append_array DOCKER_RUN_ARGS DOCKER_HOME_MOUNT
genesis_live_append_array DOCKER_RUN_ARGS DOCKER_EXTRA_ENV_FILES
DOCKER_RUN_ARGS+=(\
  -v "$CACHE_HOME_DIR":/home/node/.cache \
  -v "$ROOT_DIR":/src:ro \
  -v "$CONFIG_DIR":/home/node/.genesis \
  -v "$WORKSPACE_DIR":/home/node/.genesis/workspace \
  -v "$CLI_TOOLS_DIR":/home/node/.npm-global)
genesis_live_append_array DOCKER_RUN_ARGS EXTERNAL_AUTH_MOUNTS
genesis_live_append_array DOCKER_RUN_ARGS DOCKER_AUTH_ENV
genesis_live_append_array DOCKER_RUN_ARGS PROFILE_MOUNT
DOCKER_RUN_ARGS+=(\
  "$LIVE_IMAGE_NAME" \
  -lc "$LIVE_TEST_CMD")
"${DOCKER_RUN_ARGS[@]}"
