#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"

IMAGE_NAME="$(docker_e2e_resolve_image "genesis-npm-telegram-live-e2e" GENESIS_NPM_TELEGRAM_LIVE_E2E_IMAGE)"
DOCKER_TARGET="${GENESIS_NPM_TELEGRAM_DOCKER_TARGET:-build}"
PACKAGE_SPEC="${GENESIS_NPM_TELEGRAM_PACKAGE_SPEC:-@pixelzx/genesis@beta}"
OUTPUT_DIR="${GENESIS_NPM_TELEGRAM_OUTPUT_DIR:-.artifacts/qa-e2e/npm-telegram-live}"

resolve_credential_source() {
  if [ -n "${GENESIS_NPM_TELEGRAM_CREDENTIAL_SOURCE:-}" ]; then
    printf "%s" "$GENESIS_NPM_TELEGRAM_CREDENTIAL_SOURCE"
    return 0
  fi
  if [ -n "${GENESIS_QA_CREDENTIAL_SOURCE:-}" ]; then
    printf "%s" "$GENESIS_QA_CREDENTIAL_SOURCE"
    return 0
  fi
  if [ -n "${CI:-}" ] && [ -n "${GENESIS_QA_CONVEX_SITE_URL:-}" ]; then
    if [ -n "${GENESIS_QA_CONVEX_SECRET_CI:-}" ] || [ -n "${GENESIS_QA_CONVEX_SECRET_MAINTAINER:-}" ]; then
      printf "convex"
    fi
  fi
}

resolve_credential_role() {
  if [ -n "${GENESIS_NPM_TELEGRAM_CREDENTIAL_ROLE:-}" ]; then
    printf "%s" "$GENESIS_NPM_TELEGRAM_CREDENTIAL_ROLE"
    return 0
  fi
  if [ -n "${GENESIS_QA_CREDENTIAL_ROLE:-}" ]; then
    printf "%s" "$GENESIS_QA_CREDENTIAL_ROLE"
  fi
}

validate_genesis_package_spec() {
  local spec="$1"
  if [[ "$spec" =~ ^@pixelzx/genesis@(beta|latest|[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(-[1-9][0-9]*|-beta\.[1-9][0-9]*)?)$ ]]; then
    return 0
  fi
  echo "GENESIS_NPM_TELEGRAM_PACKAGE_SPEC must be @pixelzx/genesis@beta, @pixelzx/genesis@latest, or an exact Genesis release version; got: $spec" >&2
  exit 1
}

validate_genesis_package_spec "$PACKAGE_SPEC"

docker_e2e_build_or_reuse "$IMAGE_NAME" npm-telegram-live "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" "$DOCKER_TARGET"

mkdir -p "$ROOT_DIR/.artifacts/qa-e2e"
run_log="$(mktemp "${TMPDIR:-/tmp}/genesis-npm-telegram-live.XXXXXX")"
npm_prefix_host="$(mktemp -d "$ROOT_DIR/.artifacts/qa-e2e/npm-telegram-live-prefix.XXXXXX")"
trap 'rm -f "$run_log"; rm -rf "$npm_prefix_host"' EXIT
credential_source="$(resolve_credential_source)"
credential_role="$(resolve_credential_role)"
if [ -z "$credential_role" ] && [ -n "${CI:-}" ] && [ "$credential_source" = "convex" ]; then
  credential_role="ci"
fi

docker_env=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e GENESIS_NPM_TELEGRAM_PACKAGE_SPEC="$PACKAGE_SPEC"
  -e GENESIS_NPM_TELEGRAM_OUTPUT_DIR="$OUTPUT_DIR"
  -e GENESIS_NPM_TELEGRAM_FAST="${GENESIS_NPM_TELEGRAM_FAST:-1}"
)

forward_env_if_set() {
  local key="$1"
  if [ -n "${!key:-}" ]; then
    docker_env+=(-e "$key")
  fi
}

if [ -n "$credential_source" ]; then
  docker_env+=(-e GENESIS_QA_CREDENTIAL_SOURCE="$credential_source")
fi
if [ -n "$credential_role" ]; then
  docker_env+=(-e GENESIS_QA_CREDENTIAL_ROLE="$credential_role")
fi

for key in \
  OPENAI_API_KEY \
  ANTHROPIC_API_KEY \
  GEMINI_API_KEY \
  GOOGLE_API_KEY \
  GENESIS_LIVE_OPENAI_KEY \
  GENESIS_LIVE_ANTHROPIC_KEY \
  GENESIS_LIVE_GEMINI_KEY \
  GENESIS_QA_TELEGRAM_GROUP_ID \
  GENESIS_QA_TELEGRAM_DRIVER_BOT_TOKEN \
  GENESIS_QA_TELEGRAM_SUT_BOT_TOKEN \
  GENESIS_QA_CONVEX_SITE_URL \
  GENESIS_QA_CONVEX_SECRET_CI \
  GENESIS_QA_CONVEX_SECRET_MAINTAINER \
  GENESIS_QA_CREDENTIAL_LEASE_TTL_MS \
  GENESIS_QA_CREDENTIAL_HEARTBEAT_INTERVAL_MS \
  GENESIS_QA_CREDENTIAL_ACQUIRE_TIMEOUT_MS \
  GENESIS_QA_CREDENTIAL_HTTP_TIMEOUT_MS \
  GENESIS_QA_CONVEX_ENDPOINT_PREFIX \
  GENESIS_QA_CREDENTIAL_OWNER_ID \
  GENESIS_QA_ALLOW_INSECURE_HTTP \
  GENESIS_QA_REDACT_PUBLIC_METADATA \
  GENESIS_QA_TELEGRAM_CAPTURE_CONTENT \
  GENESIS_QA_SUITE_PROGRESS \
  GENESIS_NPM_TELEGRAM_PROVIDER_MODE \
  GENESIS_NPM_TELEGRAM_MODEL \
  GENESIS_NPM_TELEGRAM_ALT_MODEL \
  GENESIS_NPM_TELEGRAM_SCENARIOS \
  GENESIS_NPM_TELEGRAM_SUT_ACCOUNT \
  GENESIS_NPM_TELEGRAM_ALLOW_FAILURES; do
  forward_env_if_set "$key"
done

run_logged() {
  if ! "$@" >"$run_log" 2>&1; then
    cat "$run_log"
    exit 1
  fi
  cat "$run_log"
  >"$run_log"
}

echo "Running published npm Telegram live Docker E2E ($PACKAGE_SPEC)..."
run_logged docker run --rm \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e GENESIS_NPM_TELEGRAM_PACKAGE_SPEC="$PACKAGE_SPEC" \
  -v "$npm_prefix_host:/npm-global" \
  -i "$IMAGE_NAME" bash -s <<'EOF'
set -euo pipefail

export HOME="$(mktemp -d "/tmp/genesis-npm-telegram-install.XXXXXX")"
export NPM_CONFIG_PREFIX="/npm-global"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"

package_spec="${GENESIS_NPM_TELEGRAM_PACKAGE_SPEC:?missing GENESIS_NPM_TELEGRAM_PACKAGE_SPEC}"
echo "Installing ${package_spec}..."
npm install -g "$package_spec" --no-fund --no-audit

command -v genesis
genesis --version
EOF

run_logged docker run --rm \
  "${docker_env[@]}" \
  -v "$ROOT_DIR/.artifacts:/app/.artifacts" \
  -v "$npm_prefix_host:/npm-global" \
  -i "$IMAGE_NAME" bash -s <<'EOF'
set -euo pipefail

export HOME="$(mktemp -d "/tmp/genesis-npm-telegram-runtime.XXXXXX")"
export NPM_CONFIG_PREFIX="/npm-global"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
export GENESIS_NPM_TELEGRAM_REPO_ROOT="/app"

command -v genesis
genesis --version

export GENESIS_NPM_TELEGRAM_SUT_COMMAND="$(command -v genesis)"
node --import tsx scripts/e2e/npm-telegram-live-runner.ts
EOF

echo "published npm Telegram live Docker E2E passed ($PACKAGE_SPEC)"
