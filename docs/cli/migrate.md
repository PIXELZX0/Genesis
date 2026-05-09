---
summary: "CLI reference for `genesis migrate` (OpenClaw and Hermes Agent imports)"
read_when:
  - Importing an OpenClaw install into Genesis
  - Importing Hermes Agent config, credentials, skills, or state archives
title: "Migrate"
---

# `genesis migrate`

Import local config and state from OpenClaw or Hermes Agent into the active Genesis profile.

```bash
genesis migrate openclaw --dry-run
genesis migrate openclaw
genesis migrate hermes --dry-run
genesis migrate hermes --source-dir ~/.hermes-work
genesis migrate hermes --source-config ~/.hermes/config.yaml
```

## Options

| Option                   | Description                                                            |
| ------------------------ | ---------------------------------------------------------------------- |
| `--source-dir <path>`    | Source state/home directory. Defaults to `~/.openclaw` or `~/.hermes`. |
| `--source-config <path>` | Source config file. Defaults to `openclaw.json` or `config.yaml`.      |
| `--dry-run`              | Print the planned changes without writing files.                       |
| `--force`                | Overwrite existing Genesis config fields and files.                    |
| `--json`                 | Emit the migration result as JSON.                                     |

## OpenClaw

`genesis migrate openclaw` imports an OpenClaw install from `~/.openclaw` by default. If that directory does not exist, Genesis also checks the old `~/.clawdbot` location.

The OpenClaw config format is close to Genesis, so the migrator rewrites OpenClaw-specific paths and env references, then merges the result into the active Genesis config:

- `~/.openclaw` and `~/.clawdbot` paths become `~/.genesis` paths.
- `OPENCLAW_` env references become `GENESIS_` references.
- Non-config state entries are copied into the Genesis state directory.
- `.env` entries are merged into `~/.genesis/.env`, preserving existing values unless you pass `--force`.

Use `--dry-run` first if you already have Genesis state. Without `--force`, existing Genesis config fields and files win.

## Hermes Agent

`genesis migrate hermes` imports safe, portable parts of a Hermes Agent home directory:

- Main model, fallback model, timezone, workspace, and custom provider config from `config.yaml`
- `.env` entries into `~/.genesis/.env`
- API-key and static-token entries from `auth.json` into the main Genesis agent auth profiles
- `SOUL.md` into the resolved Genesis workspace
- Hermes skills into the resolved Genesis workspace `skills/` directory
- Hermes `sessions/`, `memories/`, `cron/`, and `plugins/` as archives under `~/.genesis/migrated/hermes/`

Hermes runtime sessions and memory stores are not replayed as native Genesis sessions. They are preserved as archives so you can inspect or manually port them later.

## Related

- [Backup](/cli/backup)
- [Config](/cli/config)
- [Migrating installs](/install/migrating)
