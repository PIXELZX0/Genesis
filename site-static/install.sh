#!/usr/bin/env sh
# Genesis installer for macOS / Linux.
# Source: https://github.com/PIXELZX0/Genesis (PIXELZX0 fork)
#
# This file is a placeholder served from https://genesis.pixelzx.com/install.sh.
# Replace with the real installer (forked from the upstream sst/genesis install.sh)
# before announcing the new domain publicly.

set -eu

cat >&2 <<'MSG'
Genesis installer is not yet published for this domain (genesis.pixelzx.com).

For now, install with npm or pnpm:

    npm  install -g @pixelzx/genesis
    pnpm add  -g @pixelzx/genesis

Or run from source:

    git clone https://github.com/PIXELZX0/Genesis
    cd Genesis
    pnpm install
    pnpm build
    pnpm link --global

See https://genesis.pixelzx.com/docs/install for details.
MSG

exit 1
