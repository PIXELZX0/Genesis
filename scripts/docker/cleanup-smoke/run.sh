#!/usr/bin/env bash
set -euo pipefail

cd /repo

export GENESIS_STATE_DIR="/tmp/genesis-test"
export GENESIS_CONFIG_PATH="${GENESIS_STATE_DIR}/genesis.json"

echo "==> Build"
if ! pnpm build >/tmp/genesis-cleanup-build.log 2>&1; then
  cat /tmp/genesis-cleanup-build.log
  exit 1
fi

echo "==> Seed state"
mkdir -p "${GENESIS_STATE_DIR}/credentials"
mkdir -p "${GENESIS_STATE_DIR}/agents/main/sessions"
echo '{}' >"${GENESIS_CONFIG_PATH}"
echo 'creds' >"${GENESIS_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${GENESIS_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
if ! pnpm genesis reset --scope config+creds+sessions --yes --non-interactive >/tmp/genesis-cleanup-reset.log 2>&1; then
  cat /tmp/genesis-cleanup-reset.log
  exit 1
fi

test ! -f "${GENESIS_CONFIG_PATH}"
test ! -d "${GENESIS_STATE_DIR}/credentials"
test ! -d "${GENESIS_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${GENESIS_STATE_DIR}/credentials"
echo '{}' >"${GENESIS_CONFIG_PATH}"

echo "==> Uninstall (state only)"
if ! pnpm genesis uninstall --state --yes --non-interactive >/tmp/genesis-cleanup-uninstall.log 2>&1; then
  cat /tmp/genesis-cleanup-uninstall.log
  exit 1
fi

test ! -d "${GENESIS_STATE_DIR}"

echo "OK"
