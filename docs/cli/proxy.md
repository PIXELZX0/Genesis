---
summary: "CLI reference for `genesis proxy`, the local debug proxy and capture inspector"
read_when:
  - You need to capture Genesis transport traffic locally for debugging
  - You want to inspect debug proxy sessions, blobs, or built-in query presets
title: "Proxy"
---

# `genesis proxy`

Run the local explicit debug proxy and inspect captured traffic.

This is a debugging command for transport-level investigation. It can start a
local proxy, run a child command with capture enabled, list capture sessions,
query common traffic patterns, read captured blobs, and purge local capture
data.

## Commands

```bash
genesis proxy start [--host <host>] [--port <port>]
genesis proxy run [--host <host>] [--port <port>] -- <cmd...>
genesis proxy coverage
genesis proxy sessions [--limit <count>]
genesis proxy query --preset <name> [--session <id>]
genesis proxy blob --id <blobId>
genesis proxy purge
```

## Query presets

`genesis proxy query --preset <name>` accepts:

- `double-sends`
- `retry-storms`
- `cache-busting`
- `ws-duplicate-frames`
- `missing-ack`
- `error-bursts`

## Notes

- `start` defaults to `127.0.0.1` unless `--host` is set.
- `run` starts a local debug proxy and then runs the command after `--`.
- Captures are local debugging data; use `genesis proxy purge` when finished.

## Related

- [CLI reference](/cli)
- [Trusted proxy auth](/gateway/trusted-proxy-auth)
