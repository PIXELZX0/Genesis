#!/usr/bin/env sh
# Genesis CLI-only installer for macOS / Linux.
# Source: https://github.com/PIXELZX0/Genesis (PIXELZX0 fork)
#
# This file is a placeholder served from https://genesis.pixelzx.com/install-cli.sh.

set -eu

cat >&2 <<'MSG'
The CLI-only installer for genesis.pixelzx.com is not yet published.

Install the global `genesis` CLI with npm or pnpm:

    npm  install -g @pixelzx/genesis
    pnpm add  -g @pixelzx/genesis

See https://genesis.pixelzx.com/docs/install for details.
MSG

exit 1
