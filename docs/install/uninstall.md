---
summary: "Uninstall Genesis completely (CLI, service, state, workspace)"
read_when:
  - You want to remove Genesis from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

Two paths:

- **Easy path** if `genesis` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
genesis uninstall
```

Non-interactive (automation / npx):

```bash
genesis uninstall --all --yes --non-interactive
npx -y genesis uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
genesis gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
genesis gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${GENESIS_STATE_DIR:-$HOME/.genesis}"
```

If you set `GENESIS_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.genesis/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g genesis
pnpm remove -g genesis
bun remove -g genesis
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/Genesis.app
```

Notes:

- If you used profiles (`--profile` / `GENESIS_PROFILE`), repeat step 3 for each state dir (defaults are `~/.genesis-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `genesis` is missing.

### macOS (launchd)

Default label is `ai.genesis.gateway` (or `ai.genesis.<profile>`; legacy `com.genesis.*` may still exist):

```bash
launchctl bootout gui/$UID/ai.genesis.gateway
rm -f ~/Library/LaunchAgents/ai.genesis.gateway.plist
```

If you used a profile, replace the label and plist name with `ai.genesis.<profile>`. Remove any legacy `com.genesis.*` plists if present.

### Linux (systemd user unit)

Default unit name is `genesis-gateway.service` (or `genesis-gateway-<profile>.service`):

```bash
systemctl --user disable --now genesis-gateway.service
rm -f ~/.config/systemd/user/genesis-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `Genesis Gateway` (or `Genesis Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "Genesis Gateway"
Remove-Item -Force "$env:USERPROFILE\.genesis\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.genesis-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://genesis.ai/install.sh` or `install.ps1`, the CLI was installed with `npm install -g @pixelzx/genesis@latest`.
Remove it with `npm rm -g @pixelzx/genesis` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `genesis ...` / `bun run genesis ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.

## Related

- [Install overview](/install)
- [Migration guide](/install/migrating)
