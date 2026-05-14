---
summary: "Updating Genesis safely (global install or source), plus rollback strategy"
read_when:
  - Updating Genesis
  - Something breaks after an update
title: "Updating"
---

Keep Genesis up to date.

Current stable release: `2026.5.14`.

## Recommended: `genesis update`

The fastest way to update. It detects your install type (npm or git), fetches the latest version, runs `genesis doctor`, and restarts the gateway.

```bash
genesis update
```

To switch channels or target a specific version:

```bash
genesis update --channel beta
genesis update --tag main
genesis update --dry-run   # preview without applying
```

`--channel beta` prefers beta, but the runtime falls back to stable/latest when
the beta tag is missing or older than the latest stable release. Use `--tag beta`
if you want the raw npm beta dist-tag for a one-off package update.

See [Development channels](/install/development-channels) for channel semantics.

## Alternative: re-run the installer

```bash
curl -fsSL https://genesis.ai/install.sh | bash
```

Add `--no-onboard` to skip onboarding. For source installs, pass `--install-method git --no-onboard`.

## Alternative: manual npm, pnpm, or bun

```bash
npm i -g @pixelzx/genesis@latest
```

```bash
pnpm add -g @pixelzx/genesis@latest
```

```bash
bun add -g @pixelzx/genesis@latest
```

### Global npm installs and runtime dependencies

Genesis treats packaged global installs as read-only at runtime, even when the
global package directory is writable by the current user. Bundled plugin runtime
dependencies are staged into a writable runtime directory instead of mutating the
package tree. This keeps `genesis update` from racing with a running gateway or
local agent that is repairing plugin dependencies during the same install.

Some Linux npm setups install global packages under root-owned directories such
as `/usr/lib/node_modules/genesis`. Genesis supports that layout through the
same external staging path.

For hardened systemd units, set a writable stage directory that is included in
`ReadWritePaths`:

```ini
Environment=GENESIS_PLUGIN_STAGE_DIR=/var/lib/genesis/plugin-runtime-deps
ReadWritePaths=/var/lib/genesis /home/genesis/.genesis /tmp
```

If `GENESIS_PLUGIN_STAGE_DIR` is not set, Genesis uses `$STATE_DIRECTORY` when
systemd provides it, then falls back to `~/.genesis/plugin-runtime-deps`.

### Bundled plugin runtime dependencies

Packaged installs keep bundled plugin runtime dependencies out of the read-only
package tree. On startup and during `genesis doctor --fix`, Genesis repairs
runtime dependencies only for bundled plugins that are active in config, active
through legacy channel config, or enabled by their bundled manifest default.

Explicit disablement wins. A disabled plugin or channel does not get its
runtime dependencies repaired just because it exists in the package. External
plugins and custom load paths still use `genesis plugins install` or
`genesis plugins update`.

## Auto-updater

The auto-updater is off by default. Enable it in `~/.genesis/genesis.json`:

```json5
{
  update: {
    channel: "stable",
    auto: {
      enabled: true,
      stableDelayHours: 6,
      stableJitterHours: 12,
      betaCheckIntervalHours: 1,
    },
  },
}
```

| Channel  | Behavior                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `stable` | Waits `stableDelayHours`, then applies with deterministic jitter across `stableJitterHours` (spread rollout). |
| `beta`   | Checks every `betaCheckIntervalHours` (default: hourly) and applies immediately.                              |
| `dev`    | No automatic apply. Use `genesis update` manually.                                                            |

The gateway also logs an update hint on startup (disable with `update.checkOnStart: false`).

## After updating

<Steps>

### Run doctor

```bash
genesis doctor
```

Migrates config, audits DM policies, and checks gateway health. Details: [Doctor](/gateway/doctor)

### Restart the gateway

```bash
genesis gateway restart
```

### Verify

```bash
genesis health
```

</Steps>

## Rollback

### Pin a version (npm)

```bash
npm i -g @pixelzx/genesis@<version>
genesis doctor
genesis gateway restart
```

Tip: `npm view @pixelzx/genesis version` shows the current published version.

### Pin a commit (source)

```bash
git fetch origin
git checkout "$(git rev-list -n 1 --before=\"2026-01-01\" origin/main)"
pnpm install && pnpm build
genesis gateway restart
```

To return to latest: `git checkout main && git pull`.

## If you are stuck

- Run `genesis doctor` again and read the output carefully.
- For `genesis update --channel dev` on source checkouts, the updater auto-bootstraps `pnpm` when needed. If you see a pnpm/corepack bootstrap error, install `pnpm` manually (or re-enable `corepack`) and rerun the update.
- Check: [Troubleshooting](/gateway/troubleshooting)
- Ask in Discord: [https://discord.gg/clawd](https://discord.gg/clawd)

## Related

- [Install Overview](/install) — all installation methods
- [Doctor](/gateway/doctor) — health checks after updates
- [Migrating](/install/migrating) — major version migration guides
