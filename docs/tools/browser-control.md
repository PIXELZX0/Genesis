---
summary: "Genesis browser control API, CLI reference, and scripting actions"
read_when:
  - Scripting or debugging the agent browser via the local control API
  - Looking for the `genesis browser` CLI reference
  - Adding custom browser automation with snapshots and refs
title: "Browser control API"
---

For setup, configuration, and troubleshooting, see [Browser](/tools/browser).
This page is the reference for the local control HTTP API, the `genesis browser`
CLI, and scripting patterns (snapshots, refs, waits, debug flows).

## Control API (optional)

For local integrations only, the Gateway exposes a small loopback HTTP API:

- Status/start/stop: `GET /`, `POST /start`, `POST /stop`
- Tabs: `GET /tabs`, `POST /tabs/open`, `POST /tabs/focus`, `DELETE /tabs/:targetId`
- Snapshot/screenshot: `GET /snapshot`, `POST /screenshot`
- Actions: `POST /navigate`, `POST /act`
- Hooks: `POST /hooks/file-chooser`, `POST /hooks/dialog`
- Downloads: `POST /download`, `POST /wait/download`
- Debugging: `GET /console`, `POST /pdf`
- Debugging: `GET /errors`, `GET /requests`, `POST /trace/start`, `POST /trace/stop`, `POST /highlight`
- Network: `POST /response/body`
- State: `GET /cookies`, `POST /cookies/set`, `POST /cookies/clear`
- State: `GET /storage/:kind`, `POST /storage/:kind/set`, `POST /storage/:kind/clear`
- Settings: `POST /set/offline`, `POST /set/headers`, `POST /set/credentials`, `POST /set/geolocation`, `POST /set/media`, `POST /set/timezone`, `POST /set/locale`, `POST /set/device`

All endpoints accept `?profile=<name>`.

If shared-secret gateway auth is configured, browser HTTP routes require auth too:

- `Authorization: Bearer <gateway token>`
- `x-genesis-password: <gateway password>` or HTTP Basic auth with that password

Notes:

- This standalone loopback browser API does **not** consume trusted-proxy or
  Tailscale Serve identity headers.
- If `gateway.auth.mode` is `none` or `trusted-proxy`, these loopback browser
  routes do not inherit those identity-bearing modes; keep them loopback-only.

### `/act` error contract

`POST /act` uses a structured error response for route-level validation and
policy failures:

```json
{ "error": "<message>", "code": "ACT_*" }
```

Current `code` values:

- `ACT_KIND_REQUIRED` (HTTP 400): `kind` is missing or unrecognized.
- `ACT_INVALID_REQUEST` (HTTP 400): action payload failed normalization or validation.
- `ACT_SELECTOR_UNSUPPORTED` (HTTP 400): `selector` was used with an unsupported action kind.
- `ACT_EVALUATE_DISABLED` (HTTP 403): `evaluate` (or `wait --fn`) is disabled by config.
- `ACT_TARGET_ID_MISMATCH` (HTTP 403): top-level or batched `targetId` conflicts with request target.
- `ACT_EXISTING_SESSION_UNSUPPORTED` (HTTP 501): action is not supported for existing-session profiles.

Other runtime failures may still return `{ "error": "<message>" }` without a
`code` field.

### Playwright requirement

Some features (navigate/act/AI snapshot/role snapshot, element screenshots,
PDF) require Playwright. If Playwright isn’t installed, those endpoints return
a clear 501 error.

What still works without Playwright:

- ARIA snapshots
- Page screenshots for the managed `genesis` browser when a per-tab CDP
  WebSocket is available
- Page screenshots for `existing-session` / Chrome MCP profiles
- `existing-session` ref-based screenshots (`--ref`) from snapshot output

What still needs Playwright:

- `navigate`
- `act`
- AI snapshots / role snapshots
- CSS-selector element screenshots (`--element`)
- full browser PDF export

Element screenshots also reject `--full-page`; the route returns `fullPage is
not supported for element screenshots`.

If you see `Playwright is not available in this gateway build`, repair the
bundled browser plugin runtime dependencies so `playwright-core` is installed,
then restart the gateway. For packaged installs, run `genesis doctor --fix`.
For Docker, also install the Chromium browser binaries as shown below.

#### Docker Playwright install

If your Gateway runs in Docker, avoid `npx playwright` (npm override conflicts).
Use the bundled CLI instead:

```bash
docker compose run --rm genesis-cli \
  node /app/node_modules/playwright-core/cli.js install chromium
```

To persist browser downloads, set `PLAYWRIGHT_BROWSERS_PATH` (for example,
`/home/node/.cache/ms-playwright`) and make sure `/home/node` is persisted via
`GENESIS_HOME_VOLUME` or a bind mount. See [Docker](/install/docker).

## How it works (internal)

A small loopback control server accepts HTTP requests and connects to Chromium-based browsers via CDP. Advanced actions (click/type/snapshot/PDF) go through Playwright on top of CDP; when Playwright is missing, only non-Playwright operations are available. The agent sees one stable interface while local/remote browsers and profiles swap freely underneath.

## CLI quick reference

All commands accept `--browser-profile <name>` to target a specific profile, and `--json` for machine-readable output.

<AccordionGroup>

<Accordion title="Basics: status, tabs, open/focus/close">

```bash
genesis browser status
genesis browser start
genesis browser stop            # also clears emulation on attach-only/remote CDP
genesis browser tabs
genesis browser tab             # shortcut for current tab
genesis browser tab new
genesis browser tab select 2
genesis browser tab close 2
genesis browser open https://example.com
genesis browser focus abcd1234
genesis browser close abcd1234
```

</Accordion>

<Accordion title="Inspection: screenshot, snapshot, console, errors, requests">

```bash
genesis browser screenshot
genesis browser screenshot --full-page
genesis browser screenshot --ref 12        # or --ref e12
genesis browser screenshot --labels
genesis browser snapshot
genesis browser snapshot --format aria --limit 200
genesis browser snapshot --interactive --compact --depth 6
genesis browser snapshot --efficient
genesis browser snapshot --labels
genesis browser snapshot --urls
genesis browser snapshot --selector "#main" --interactive
genesis browser snapshot --frame "iframe#main" --interactive
genesis browser console --level error
genesis browser errors --clear
genesis browser requests --filter api --clear
genesis browser pdf
genesis browser responsebody "**/api" --max-chars 5000
```

</Accordion>

<Accordion title="Actions: navigate, click, type, drag, wait, evaluate">

```bash
genesis browser navigate https://example.com
genesis browser resize 1280 720
genesis browser click 12 --double           # or e12 for role refs
genesis browser click-coords 120 340        # viewport coordinates
genesis browser type 23 "hello" --submit
genesis browser press Enter
genesis browser hover 44
genesis browser scrollintoview e12
genesis browser drag 10 11
genesis browser select 9 OptionA OptionB
genesis browser download e12 report.pdf
genesis browser waitfordownload report.pdf
genesis browser upload /tmp/genesis/uploads/file.pdf
genesis browser fill --fields '[{"ref":"1","type":"text","value":"Ada"}]'
genesis browser dialog --accept
genesis browser wait --text "Done"
genesis browser wait "#main" --url "**/dash" --load networkidle --fn "window.ready===true"
genesis browser evaluate --fn '(el) => el.textContent' --ref 7
genesis browser highlight e12
genesis browser trace start
genesis browser trace stop
```

</Accordion>

<Accordion title="State: cookies, storage, offline, headers, geo, device">

```bash
genesis browser cookies
genesis browser cookies set session abc123 --url "https://example.com"
genesis browser cookies clear
genesis browser storage local get
genesis browser storage local set theme dark
genesis browser storage session clear
genesis browser set offline on
genesis browser set headers --headers-json '{"X-Debug":"1"}'
genesis browser set credentials user pass            # --clear to remove
genesis browser set geo 37.7749 -122.4194 --origin "https://example.com"
genesis browser set media dark
genesis browser set timezone America/New_York
genesis browser set locale en-US
genesis browser set device "iPhone 14"
```

</Accordion>

</AccordionGroup>

Notes:

- `upload` and `dialog` are **arming** calls; run them before the click/press that triggers the chooser/dialog.
- `click`/`type`/etc require a `ref` from `snapshot` (numeric `12` or role ref `e12`). CSS selectors are intentionally not supported for actions. Use `click-coords` when the visible viewport position is the only reliable target.
- Download, trace, and upload paths are constrained to Genesis temp roots: `/tmp/genesis{,/downloads,/uploads}` (fallback: `${os.tmpdir()}/genesis/...`).
- `upload` can also set file inputs directly via `--input-ref` or `--element`.

Snapshot flags at a glance:

- `--format ai` (default with Playwright): AI snapshot with numeric refs (`aria-ref="<n>"`).
- `--format aria`: accessibility tree, no refs; inspection only.
- `--efficient` (or `--mode efficient`): compact role snapshot preset. Set `browser.snapshotDefaults.mode: "efficient"` to make this the default (see [Gateway configuration](/gateway/configuration-reference#browser)).
- `--interactive`, `--compact`, `--depth`, `--selector` force a role snapshot with `ref=e12` refs. `--frame "<iframe>"` scopes role snapshots to an iframe.
- `--labels` adds a viewport-only screenshot with overlayed ref labels (prints `MEDIA:<path>`).
- `--urls` appends discovered link destinations to AI snapshots.

## Snapshots and refs

Genesis supports two “snapshot” styles:

- **AI snapshot (numeric refs)**: `genesis browser snapshot` (default; `--format ai`)
  - Output: a text snapshot that includes numeric refs.
  - Actions: `genesis browser click 12`, `genesis browser type 23 "hello"`.
  - Internally, the ref is resolved via Playwright’s `aria-ref`.

- **Role snapshot (role refs like `e12`)**: `genesis browser snapshot --interactive` (or `--compact`, `--depth`, `--selector`, `--frame`)
  - Output: a role-based list/tree with `[ref=e12]` (and optional `[nth=1]`).
  - Actions: `genesis browser click e12`, `genesis browser highlight e12`.
  - Internally, the ref is resolved via `getByRole(...)` (plus `nth()` for duplicates).
  - Add `--labels` to include a viewport screenshot with overlayed `e12` labels.
  - Add `--urls` when link text is ambiguous and the agent needs concrete
    navigation targets.

Ref behavior:

- Refs are **not stable across navigations**; if something fails, re-run `snapshot` and use a fresh ref.
- If the role snapshot was taken with `--frame`, role refs are scoped to that iframe until the next role snapshot.

## Wait power-ups

You can wait on more than just time/text:

- Wait for URL (globs supported by Playwright):
  - `genesis browser wait --url "**/dash"`
- Wait for load state:
  - `genesis browser wait --load networkidle`
- Wait for a JS predicate:
  - `genesis browser wait --fn "window.ready===true"`
- Wait for a selector to become visible:
  - `genesis browser wait "#main"`

These can be combined:

```bash
genesis browser wait "#main" \
  --url "**/dash" \
  --load networkidle \
  --fn "window.ready===true" \
  --timeout-ms 15000
```

## Debug workflows

When an action fails (e.g. “not visible”, “strict mode violation”, “covered”):

1. `genesis browser snapshot --interactive`
2. Use `click <ref>` / `type <ref>` (prefer role refs in interactive mode)
3. If it still fails: `genesis browser highlight <ref>` to see what Playwright is targeting
4. If the page behaves oddly:
   - `genesis browser errors --clear`
   - `genesis browser requests --filter api --clear`
5. For deep debugging: record a trace:
   - `genesis browser trace start`
   - reproduce the issue
   - `genesis browser trace stop` (prints `TRACE:<path>`)

## JSON output

`--json` is for scripting and structured tooling.

Examples:

```bash
genesis browser status --json
genesis browser snapshot --interactive --json
genesis browser requests --filter api --json
genesis browser cookies --json
```

Role snapshots in JSON include `refs` plus a small `stats` block (lines/chars/refs/interactive) so tools can reason about payload size and density.

## State and environment knobs

These are useful for “make the site behave like X” workflows:

- Cookies: `cookies`, `cookies set`, `cookies clear`
- Storage: `storage local|session get|set|clear`
- Offline: `set offline on|off`
- Headers: `set headers --headers-json '{"X-Debug":"1"}'` (legacy `set headers --json '{"X-Debug":"1"}'` remains supported)
- HTTP basic auth: `set credentials user pass` (or `--clear`)
- Geolocation: `set geo <lat> <lon> --origin "https://example.com"` (or `--clear`)
- Media: `set media dark|light|no-preference|none`
- Timezone / locale: `set timezone ...`, `set locale ...`
- Device / viewport:
  - `set device "iPhone 14"` (Playwright device presets)
  - `set viewport 1280 720`

## Security and privacy

- The genesis browser profile may contain logged-in sessions; treat it as sensitive.
- `browser act kind=evaluate` / `genesis browser evaluate` and `wait --fn`
  execute arbitrary JavaScript in the page context. Prompt injection can steer
  this. Disable it with `browser.evaluateEnabled=false` if you do not need it.
- For logins and anti-bot notes (X/Twitter, etc.), see [Browser login + X/Twitter posting](/tools/browser-login).
- Keep the Gateway/node host private (loopback or tailnet-only).
- Remote CDP endpoints are powerful; tunnel and protect them.

Strict-mode example (block private/internal destinations by default):

```json5
{
  browser: {
    ssrfPolicy: {
      dangerouslyAllowPrivateNetwork: false,
      hostnameAllowlist: ["*.example.com", "example.com"],
      allowedHostnames: ["localhost"], // optional exact allow
    },
  },
}
```

## Related

- [Browser](/tools/browser) — overview, configuration, profiles, security
- [Browser login](/tools/browser-login) — signing in to sites
- [Browser Linux troubleshooting](/tools/browser-linux-troubleshooting)
- [Browser WSL2 troubleshooting](/tools/browser-wsl2-windows-remote-cdp-troubleshooting)
