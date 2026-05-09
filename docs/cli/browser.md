---
summary: "CLI reference for `genesis browser` (lifecycle, profiles, tabs, actions, state, and debugging)"
read_when:
  - You use `genesis browser` and want examples for common tasks
  - You want to control a browser running on another machine via a node host
  - You want to attach to your local signed-in Chrome via Chrome MCP
title: "Browser"
---

# `genesis browser`

Manage Genesis's browser control surface and run browser actions (lifecycle, profiles, tabs, snapshots, screenshots, navigation, input, state emulation, and debugging).

Related:

- Browser tool + API: [Browser tool](/tools/browser)

## Common flags

- `--url <gatewayWsUrl>`: Gateway WebSocket URL (defaults to config).
- `--token <token>`: Gateway token (if required).
- `--timeout <ms>`: request timeout (ms).
- `--expect-final`: wait for a final Gateway response.
- `--browser-profile <name>`: choose a browser profile (default from config).
- `--json`: machine-readable output (where supported).

## Quick start (local)

```bash
genesis browser profiles
genesis browser --browser-profile genesis start
genesis browser --browser-profile genesis open https://example.com
genesis browser --browser-profile genesis snapshot
```

Agents can run the same readiness check with `browser({ action: "doctor" })`.

## Quick troubleshooting

If `start` fails with `not reachable after start`, troubleshoot CDP readiness first. If `start` and `tabs` succeed but `open` or `navigate` fails, the browser control plane is healthy and the failure is usually navigation SSRF policy.

Minimal sequence:

```bash
genesis browser --browser-profile genesis doctor
genesis browser --browser-profile genesis start
genesis browser --browser-profile genesis tabs
genesis browser --browser-profile genesis open https://example.com
```

Detailed guidance: [Browser troubleshooting](/tools/browser#cdp-startup-failure-vs-navigation-ssrf-block)

## Lifecycle

```bash
genesis browser status
genesis browser doctor
genesis browser start
genesis browser stop
genesis browser --browser-profile genesis reset-profile
```

Notes:

- For `attachOnly` and remote CDP profiles, `genesis browser stop` closes the
  active control session and clears temporary emulation overrides even when
  Genesis did not launch the browser process itself.
- For local managed profiles, `genesis browser stop` stops the spawned browser
  process.

## If the command is missing

If `genesis browser` is an unknown command, check `plugins.allow` in
`~/.genesis/genesis.json`.

When `plugins.allow` is present, the bundled browser plugin must be listed
explicitly:

```json5
{
  plugins: {
    allow: ["telegram", "browser"],
  },
}
```

`browser.enabled=true` does not restore the CLI subcommand when the plugin
allowlist excludes `browser`.

Related: [Browser tool](/tools/browser#missing-browser-command-or-tool)

## Profiles

Profiles are named browser routing configs. In practice:

- `genesis`: launches or attaches to a dedicated Genesis-managed Chrome instance (isolated user data dir).
- `user`: controls your existing signed-in Chrome session via Chrome DevTools MCP.
- custom CDP profiles: point at a local or remote CDP endpoint.

```bash
genesis browser profiles
genesis browser create-profile --name work --color "#FF5A36"
genesis browser create-profile --name chrome-live --driver existing-session
genesis browser create-profile --name remote --cdp-url https://browser-host.example.com
genesis browser create-profile --name onion
genesis browser delete-profile --name work
```

Use a specific profile:

```bash
genesis browser --browser-profile work tabs
```

## Tor profiles

Tor is enabled by default for local managed browser profiles. Create a
dedicated managed profile for onion-service workflows:

```bash
genesis browser create-profile --name onion
genesis browser --browser-profile onion start
genesis browser --browser-profile onion open http://examplehiddenservice.onion
```

Managed mode uses `tor` from PATH by default and, when no explicit executable
path is configured, tries to install the host Tor package automatically if it is
missing. The optional `--tor` flag persists an explicit per-profile Tor setting,
which is useful when the global default is disabled. By default, regular
domains and IP literals stay on clearnet and only `.onion` HTTP(S) URLs use Tor.
To point at a specific executable, an existing SOCKS endpoint, or whole-browser
Tor routing, configure `browser.profiles.<name>.tor` in
`~/.genesis/genesis.json`.
Details: [Browser tool](/tools/browser#tor-and-onion-services).

## Tabs

```bash
genesis browser tabs
genesis browser tab new --label docs
genesis browser tab label t1 docs
genesis browser tab select 2
genesis browser tab close 2
genesis browser open https://docs.genesis.ai --label docs
genesis browser focus docs
genesis browser close t1
```

`tabs` returns `suggestedTargetId` first, then the stable `tabId` such as `t1`,
the optional label, and the raw `targetId`. Agents should pass
`suggestedTargetId` back into `focus`, `close`, snapshots, and actions. You can
assign a label with `open --label`, `tab new --label`, or `tab label`; labels,
tab ids, raw target ids, and unique target-id prefixes are all accepted.

## Snapshot / screenshot / actions

Snapshot:

```bash
genesis browser snapshot
genesis browser snapshot --urls
```

Screenshot:

```bash
genesis browser screenshot
genesis browser screenshot --full-page
genesis browser screenshot --ref e12
genesis browser screenshot --labels
```

Notes:

- `--full-page` is for page captures only; it cannot be combined with `--ref`
  or `--element`.
- `existing-session` / `user` profiles support page screenshots and `--ref`
  screenshots from snapshot output, but not CSS `--element` screenshots.
- `--labels` overlays current snapshot refs on the screenshot.
- `snapshot --urls` appends discovered link destinations to AI snapshots so
  agents can choose direct navigation targets instead of guessing from link
  text alone.

Navigate/click/type (ref-based UI automation):

```bash
genesis browser navigate https://example.com
genesis browser click <ref>
genesis browser click-coords 120 340
genesis browser type <ref> "hello"
genesis browser press Enter
genesis browser hover <ref>
genesis browser scrollintoview <ref>
genesis browser drag <startRef> <endRef>
genesis browser select <ref> OptionA OptionB
genesis browser fill --fields '[{"ref":"1","value":"Ada"}]'
genesis browser wait --text "Done"
genesis browser evaluate --fn '(el) => el.textContent' --ref <ref>
```

File + dialog helpers:

```bash
genesis browser upload /tmp/genesis/uploads/file.pdf --ref <ref>
genesis browser waitfordownload
genesis browser download <ref> report.pdf
genesis browser dialog --accept
```

## State and storage

Viewport + emulation:

```bash
genesis browser resize 1280 720
genesis browser set viewport 1280 720
genesis browser set offline on
genesis browser set media dark
genesis browser set timezone Europe/London
genesis browser set locale en-GB
genesis browser set geo 51.5074 -0.1278 --accuracy 25
genesis browser set device "iPhone 14"
genesis browser set headers '{"x-test":"1"}'
genesis browser set credentials myuser mypass
```

Cookies + storage:

```bash
genesis browser cookies
genesis browser cookies set session abc123 --url https://example.com
genesis browser cookies clear
genesis browser storage local get
genesis browser storage local set token abc123
genesis browser storage session clear
```

## Debugging

```bash
genesis browser console --level error
genesis browser pdf
genesis browser responsebody "**/api"
genesis browser highlight <ref>
genesis browser errors --clear
genesis browser requests --filter api
genesis browser trace start
genesis browser trace stop --out trace.zip
```

## Existing Chrome via MCP

Use the built-in `user` profile, or create your own `existing-session` profile:

```bash
genesis browser --browser-profile user tabs
genesis browser create-profile --name chrome-live --driver existing-session
genesis browser create-profile --name brave-live --driver existing-session --user-data-dir "~/Library/Application Support/BraveSoftware/Brave-Browser"
genesis browser --browser-profile chrome-live tabs
```

This path is host-only. For Docker, headless servers, Browserless, or other remote setups, use a CDP profile instead.

Current existing-session limits:

- snapshot-driven actions use refs, not CSS selectors
- `browser.actionTimeoutMs` defaults supported `act` requests to 60000 ms when
  callers omit `timeoutMs`; per-call `timeoutMs` still wins.
- `click` is left-click only
- `type` does not support `slowly=true`
- `press` does not support `delayMs`
- `hover`, `scrollintoview`, `drag`, `select`, `fill`, and `evaluate` reject
  per-call timeout overrides
- `select` supports one value only
- `wait --load networkidle` is not supported
- file uploads require `--ref` / `--input-ref`, do not support CSS
  `--element`, and currently support one file at a time
- dialog hooks do not support `--timeout`
- screenshots support page captures and `--ref`, but not CSS `--element`
- `responsebody`, download interception, PDF export, and batch actions still
  require a managed browser or raw CDP profile

## Remote browser control (node host proxy)

If the Gateway runs on a different machine than the browser, run a **node host** on the machine that has Chrome/Brave/Edge/Chromium. The Gateway will proxy browser actions to that node (no separate browser control server required).

Use `gateway.nodes.browser.mode` to control auto-routing and `gateway.nodes.browser.node` to pin a specific node if multiple are connected.

Security + remote setup: [Browser tool](/tools/browser), [Remote access](/gateway/remote), [Tailscale](/gateway/tailscale), [Security](/gateway/security)

## Related

- [CLI reference](/cli)
- [Browser](/tools/browser)
