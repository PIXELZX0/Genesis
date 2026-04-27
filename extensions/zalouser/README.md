# @genesis/zalouser

Genesis extension for Zalo Personal Account messaging via native `zca-js` integration.

> **Warning:** Using Zalo automation may result in account suspension or ban. Use at your own risk. This is an unofficial integration.

## Features

- Channel plugin integration with setup wizard + QR login
- In-process listener/sender via `zca-js` (no external CLI)
- Multi-account support
- Agent tool integration (`zalouser`)
- DM/group policy support

## Prerequisites

- Genesis Gateway
- Zalo mobile app (for QR login)

No external `zca`, `openzca`, or `zca-cli` binary is required.

## Install

### Option A: npm

```bash
genesis plugins install @genesis/zalouser
```

### Option B: local source checkout

```bash
PLUGIN_SRC=./path/to/local/zalouser-plugin
genesis plugins install "$PLUGIN_SRC"
cd "$PLUGIN_SRC" && pnpm install
```

Restart the Gateway after install.

## Quick start

### Login (QR)

```bash
genesis channels login --channel zalouser
```

Scan the QR code with the Zalo app on your phone.

### Enable channel

```yaml
channels:
  zalouser:
    enabled: true
    dmPolicy: pairing # pairing | allowlist | open | disabled
```

### Send a message

```bash
genesis message send --channel zalouser --target <threadId> --message "Hello from Genesis"
```

## Configuration

Basic:

```yaml
channels:
  zalouser:
    enabled: true
    dmPolicy: pairing
```

Multi-account:

```yaml
channels:
  zalouser:
    enabled: true
    defaultAccount: default
    accounts:
      default:
        enabled: true
        profile: default
      work:
        enabled: true
        profile: work
```

## Useful commands

```bash
genesis channels login --channel zalouser
genesis channels login --channel zalouser --account work
genesis channels status --probe
genesis channels logout --channel zalouser

genesis directory self --channel zalouser
genesis directory peers list --channel zalouser --query "name"
genesis directory groups list --channel zalouser --query "work"
genesis directory groups members --channel zalouser --group-id <id>
```

## Agent tool

The extension registers a `zalouser` tool for AI agents.

Available actions: `send`, `image`, `link`, `friends`, `groups`, `me`, `status`

## Troubleshooting

- Login not persisted: `genesis channels logout --channel zalouser && genesis channels login --channel zalouser`
- Probe status: `genesis channels status --probe`
- Name resolution issues (allowlist/groups): use numeric IDs or exact Zalo names

## Credits

Built on [zca-js](https://github.com/RFS-ADRENO/zca-js).
