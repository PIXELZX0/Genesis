---
summary: "Advanced setup and development workflows for Genesis"
read_when:
  - Setting up a new machine
  - You want “latest + greatest” without breaking your personal setup
title: "Setup"
---

<Note>
If you are setting up for the first time, start with [Getting Started](/start/getting-started).
For onboarding details, see [Onboarding (CLI)](/start/wizard).
</Note>

## TL;DR

Pick a setup workflow based on how often you want updates and whether you want to run the Gateway yourself:

- **Tailoring lives outside the repo:** keep your config and workspace in `~/.genesis/genesis.json` and `~/.genesis/workspace/` so repo updates don't touch them.
- **Stable workflow (recommended for most):** install the macOS app and let it run the bundled Gateway.
- **Bleeding edge workflow (dev):** run the Gateway yourself via `pnpm gateway:watch`, then let the macOS app attach in Local mode.

## Prereqs (from source)

- Node 24 recommended (Node 22 LTS, currently `22.14+`, still supported)
- `pnpm` preferred (or Bun if you intentionally use the [Bun workflow](/install/bun))
- Docker (optional; only for containerized setup/e2e — see [Docker](/install/docker))

## Tailoring strategy (so updates do not hurt)

If you want “100% tailored to me” _and_ easy updates, keep your customization in:

- **Config:** `~/.genesis/genesis.json` (JSON/JSON5-ish)
- **Workspace:** `~/.genesis/workspace` (skills, prompts, memories; make it a private git repo)

Bootstrap once:

```bash
genesis setup
```

From inside this repo, use the local CLI entry:

```bash
genesis setup
```

If you don’t have a global install yet, run it via `pnpm genesis setup` (or `bun run genesis setup` if you are using the Bun workflow).

## Run the Gateway from this repo

After `pnpm build`, you can run the packaged CLI directly:

```bash
node genesis.mjs gateway --port 18789 --verbose
```

## Stable workflow (macOS app first)

1. Install + launch **Genesis.app** (menu bar).
2. Complete the onboarding/permissions checklist (TCC prompts).
3. Ensure Gateway is **Local** and running (the app manages it).
4. Link surfaces (example: WhatsApp):

```bash
genesis channels login
```

5. Sanity check:

```bash
genesis health
```

If onboarding is not available in your build:

- Run `genesis setup`, then `genesis channels login`, then start the Gateway manually (`genesis gateway`).

## Bleeding edge workflow (Gateway in a terminal)

Goal: work on the TypeScript Gateway, get hot reload, keep the macOS app UI attached.

### 0) (Optional) Run the macOS app from source too

If you also want the macOS app on the bleeding edge:

```bash
./scripts/restart-mac.sh
```

### 1) Start the dev Gateway

```bash
pnpm install
# First run only (or after resetting local Genesis config/workspace)
pnpm genesis setup
pnpm gateway:watch
```

`gateway:watch` runs the gateway in watch mode and reloads on relevant source,
config, and bundled-plugin metadata changes.
`pnpm genesis setup` is the one-time local config/workspace initialization step for a fresh checkout.
`pnpm gateway:watch` does not rebuild `dist/control-ui`, so rerun `pnpm ui:build` after `ui/` changes or use `pnpm ui:dev` while developing the Control UI.

If you are intentionally using the Bun workflow, the equivalent commands are:

```bash
bun install
# First run only (or after resetting local Genesis config/workspace)
bun run genesis setup
bun run gateway:watch
```

### 2) Point the macOS app at your running Gateway

In **Genesis.app**:

- Connection Mode: **Local**
  The app will attach to the running gateway on the configured port.

### 3) Verify

- In-app Gateway status should read **“Using existing gateway …”**
- Or via CLI:

```bash
genesis health
```

### Common footguns

- **Wrong port:** Gateway WS defaults to `ws://127.0.0.1:18789`; keep app + CLI on the same port.
- **Where state lives:**
  - Channel/provider state: `~/.genesis/credentials/`
  - Model auth profiles: `~/.genesis/agents/<agentId>/agent/auth-profiles.json`
  - Sessions: `~/.genesis/agents/<agentId>/sessions/`
  - Logs: `/tmp/genesis/`

## Credential storage map

Use this when debugging auth or deciding what to back up:

- **WhatsApp**: `~/.genesis/credentials/whatsapp/<accountId>/creds.json`
- **Telegram bot token**: config/env or `channels.telegram.tokenFile` (regular file only; symlinks rejected)
- **Discord bot token**: config/env or SecretRef (env/file/exec providers)
- **Slack tokens**: config/env (`channels.slack.*`)
- **Pairing allowlists**:
  - `~/.genesis/credentials/<channel>-allowFrom.json` (default account)
  - `~/.genesis/credentials/<channel>-<accountId>-allowFrom.json` (non-default accounts)
- **Model auth profiles**: `~/.genesis/agents/<agentId>/agent/auth-profiles.json`
- **File-backed secrets payload (optional)**: `~/.genesis/secrets.json`
- **Legacy OAuth import**: `~/.genesis/credentials/oauth.json`
  More detail: [Security](/gateway/security#credential-storage-map).

## Updating (without wrecking your setup)

- Keep `~/.genesis/workspace` and `~/.genesis/` as “your stuff”; don’t put personal prompts/config into the `genesis` repo.
- Updating source: `git pull` + your chosen package-manager install step (`pnpm install` by default; `bun install` for Bun workflow) + keep using the matching `gateway:watch` command.

## Linux (systemd user service)

Linux installs use a systemd **user** service. By default, systemd stops user
services on logout/idle, which kills the Gateway. Onboarding attempts to enable
lingering for you (may prompt for sudo). If it’s still off, run:

```bash
sudo loginctl enable-linger $USER
```

For always-on or multi-user servers, consider a **system** service instead of a
user service (no lingering needed). See [Gateway runbook](/gateway) for the systemd notes.

## Related docs

- [Gateway runbook](/gateway) (flags, supervision, ports)
- [Gateway configuration](/gateway/configuration) (config schema + examples)
- [Discord](/channels/discord) and [Telegram](/channels/telegram) (reply tags + replyToMode settings)
- [Genesis assistant setup](/start/genesis)
- [macOS app](/platforms/macos) (gateway lifecycle)
