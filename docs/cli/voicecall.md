---
summary: "CLI reference for `genesis voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall setup|smoke|call|continue|dtmf|status|tail|expose`
title: "Voicecall"
---

# `genesis voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:

- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
genesis voicecall setup
genesis voicecall smoke
genesis voicecall status --call-id <id>
genesis voicecall call --to "+15555550123" --message "Hello" --mode notify
genesis voicecall continue --call-id <id> --message "Any questions?"
genesis voicecall dtmf --call-id <id> --digits "ww123456#"
genesis voicecall end --call-id <id>
```

`setup` prints human-readable readiness checks by default. Use `--json` for
scripts:

```bash
genesis voicecall setup --json
```

For external providers (`twilio`, `telnyx`, `plivo`), setup must resolve a public
webhook URL from `publicUrl`, a tunnel, or Tailscale exposure. A loopback/private
serve fallback is rejected because carriers cannot reach it.

`smoke` runs the same readiness checks. It will not place a real phone call
unless both `--to` and `--yes` are present:

```bash
genesis voicecall smoke --to "+15555550123"        # dry run
genesis voicecall smoke --to "+15555550123" --yes  # live notify call
```

## Exposing webhooks (Tailscale)

```bash
genesis voicecall expose --mode serve
genesis voicecall expose --mode funnel
genesis voicecall expose --mode off
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.

## Related

- [CLI reference](/cli)
- [Voice call plugin](/plugins/voice-call)
