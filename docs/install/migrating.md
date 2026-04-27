---
summary: "Move (migrate) an Genesis install from one machine to another"
read_when:
  - You are moving Genesis to a new laptop/server
  - You want to preserve sessions, auth, and channel logins (WhatsApp, etc.)
title: "Migration guide"
---

# Migrating Genesis to a New Machine

This guide moves an Genesis gateway to a new machine without redoing onboarding.

## What Gets Migrated

When you copy the **state directory** (`~/.genesis/` by default) and your **workspace**, you preserve:

- **Config** -- `genesis.json` and all gateway settings
- **Auth** -- per-agent `auth-profiles.json` (API keys + OAuth), plus any channel/provider state under `credentials/`
- **Sessions** -- conversation history and agent state
- **Channel state** -- WhatsApp login, Telegram session, etc.
- **Workspace files** -- `MEMORY.md`, `USER.md`, skills, and prompts

<Tip>
Run `genesis status` on the old machine to confirm your state directory path.
Custom profiles use `~/.genesis-<profile>/` or a path set via `GENESIS_STATE_DIR`.
</Tip>

## Migration Steps

<Steps>
  <Step title="Stop the gateway and back up">
    On the **old** machine, stop the gateway so files are not changing mid-copy, then archive:

    ```bash
    genesis gateway stop
    cd ~
    tar -czf genesis-state.tgz .genesis
    ```

    If you use multiple profiles (e.g. `~/.genesis-work`), archive each separately.

  </Step>

  <Step title="Install Genesis on the new machine">
    [Install](/install) the CLI (and Node if needed) on the new machine.
    It is fine if onboarding creates a fresh `~/.genesis/` -- you will overwrite it next.
  </Step>

  <Step title="Copy state directory and workspace">
    Transfer the archive via `scp`, `rsync -a`, or an external drive, then extract:

    ```bash
    cd ~
    tar -xzf genesis-state.tgz
    ```

    Ensure hidden directories were included and file ownership matches the user that will run the gateway.

  </Step>

  <Step title="Run doctor and verify">
    On the new machine, run [Doctor](/gateway/doctor) to apply config migrations and repair services:

    ```bash
    genesis doctor
    genesis gateway restart
    genesis status
    ```

  </Step>
</Steps>

## Common Pitfalls

<AccordionGroup>
  <Accordion title="Profile or state-dir mismatch">
    If the old gateway used `--profile` or `GENESIS_STATE_DIR` and the new one does not,
    channels will appear logged out and sessions will be empty.
    Launch the gateway with the **same** profile or state-dir you migrated, then rerun `genesis doctor`.
  </Accordion>

  <Accordion title="Copying only genesis.json">
    The config file alone is not enough. Model auth profiles live under
    `agents/<agentId>/agent/auth-profiles.json`, and channel/provider state still
    lives under `credentials/`. Always migrate the **entire** state directory.
  </Accordion>

  <Accordion title="Permissions and ownership">
    If you copied as root or switched users, the gateway may fail to read credentials.
    Ensure the state directory and workspace are owned by the user running the gateway.
  </Accordion>

  <Accordion title="Remote mode">
    If your UI points at a **remote** gateway, the remote host owns sessions and workspace.
    Migrate the gateway host itself, not your local laptop. See [FAQ](/help/faq#where-things-live-on-disk).
  </Accordion>

  <Accordion title="Secrets in backups">
    The state directory contains auth profiles, channel credentials, and other
    provider state.
    Store backups encrypted, avoid insecure transfer channels, and rotate keys if you suspect exposure.
  </Accordion>
</AccordionGroup>

## Verification Checklist

On the new machine, confirm:

- [ ] `genesis status` shows the gateway running
- [ ] Channels are still connected (no re-pairing needed)
- [ ] The dashboard opens and shows existing sessions
- [ ] Workspace files (memory, configs) are present

## Related

- [Install overview](/install)
- [Matrix migration](/install/migrating-matrix)
- [Uninstall](/install/uninstall)
