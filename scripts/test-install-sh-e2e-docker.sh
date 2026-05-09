#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${GENESIS_INSTALL_E2E_IMAGE:-genesis-install-e2e:local}"
INSTALL_URL="${GENESIS_INSTALL_URL:-https://raw.githubusercontent.com/PIXELZX0/Genesis/main/scripts/install.sh}"

OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_API_TOKEN="${ANTHROPIC_API_TOKEN:-}"
GENESIS_E2E_MODELS="${GENESIS_E2E_MODELS:-}"

echo "==> Build image: $IMAGE_NAME"
docker build \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/scripts/docker/install-sh-e2e/Dockerfile" \
  "$ROOT_DIR/scripts/docker"

echo "==> Run E2E installer test"
docker run --rm \
  -e GENESIS_INSTALL_URL="$INSTALL_URL" \
  -e GENESIS_INSTALL_TAG="${GENESIS_INSTALL_TAG:-latest}" \
  -e GENESIS_E2E_MODELS="$GENESIS_E2E_MODELS" \
  -e GENESIS_INSTALL_E2E_PREVIOUS="${GENESIS_INSTALL_E2E_PREVIOUS:-}" \
  -e GENESIS_INSTALL_E2E_SKIP_PREVIOUS="${GENESIS_INSTALL_E2E_SKIP_PREVIOUS:-0}" \
  -e GENESIS_INSTALL_E2E_AGENT_TURN_TIMEOUT_SECONDS="${GENESIS_INSTALL_E2E_AGENT_TURN_TIMEOUT_SECONDS:-600}" \
  -e GENESIS_NO_ONBOARD=1 \
  -e OPENAI_API_KEY \
  -e ANTHROPIC_API_KEY \
  -e ANTHROPIC_API_TOKEN \
  "$IMAGE_NAME"
