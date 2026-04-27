---
summary: "CLI reference for `genesis tui` (Gateway-backed or local embedded terminal UI)"
read_when:
  - You want a terminal UI for the Gateway (remote-friendly)
  - You want to pass url/token/session from scripts
  - You want to run the TUI in local embedded mode without a Gateway
  - You want to use genesis chat or genesis tui --local
title: "TUI"
---

# `genesis tui`

Open the terminal UI connected to the Gateway, or run it in local embedded
mode.

Related:

- TUI guide: [TUI](/web/tui)

Notes:

- `chat` and `terminal` are aliases for `genesis tui --local`.
- `--local` cannot be combined with `--url`, `--token`, or `--password`.
- `tui` resolves configured gateway auth SecretRefs for token/password auth when possible (`env`/`file`/`exec` providers).
- When launched from inside a configured agent workspace directory, TUI auto-selects that agent for the session key default (unless `--session` is explicitly `agent:<id>:...`).
- Local mode uses the embedded agent runtime directly. Most local tools work, but Gateway-only features are unavailable.
- Local mode adds `/auth [provider]` inside the TUI command surface.
- Plugin approval gates still apply in local mode. Tools that require approval prompt for a decision in the terminal; nothing is silently auto-approved because the Gateway is not involved.

## Examples

```bash
genesis chat
genesis tui --local
genesis tui
genesis tui --url ws://127.0.0.1:18789 --token <token>
genesis tui --session main --deliver
genesis chat --message "Compare my config to the docs and tell me what to fix"
# when run inside an agent workspace, infers that agent automatically
genesis tui --session bugfix
```

## Config repair loop

Use local mode when the current config already validates and you want the
embedded agent to inspect it, compare it against the docs, and help repair it
from the same terminal:

If `genesis config validate` is already failing, use `genesis configure` or
`genesis doctor --fix` first. `genesis chat` does not bypass the invalid-
config guard.

```bash
genesis chat
```

Then inside the TUI:

```text
!genesis config file
!genesis docs gateway auth token secretref
!genesis config validate
!genesis doctor
```

Apply targeted fixes with `genesis config set` or `genesis configure`, then
rerun `genesis config validate`. See [TUI](/web/tui) and [Config](/cli/config).

## Related

- [CLI reference](/cli)
- [TUI](/web/tui)
