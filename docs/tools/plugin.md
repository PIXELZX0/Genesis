---
summary: "Install, configure, and manage Genesis plugins"
read_when:
  - Installing or configuring plugins
  - Understanding plugin discovery and load rules
  - Working with Codex/Claude-compatible plugin bundles
title: "Plugins"
sidebarTitle: "Install and Configure"
---

Plugins extend Genesis with new capabilities: channels, model providers,
agent harnesses, tools, skills, speech, realtime transcription, realtime
voice, media-understanding, image generation, video generation, web fetch, web
search, and more. Some plugins are **core** (shipped with Genesis), others
are **external** (published on npm by the community).

## Quick start

<Steps>
  <Step title="See what is loaded">
    ```bash
    genesis plugins list
    ```
  </Step>

  <Step title="Install a plugin">
    ```bash
    # From npm
    genesis plugins install @genesis/voice-call

    # From a local directory or archive
    genesis plugins install ./my-plugin
    genesis plugins install ./my-plugin.tgz
    ```

  </Step>

  <Step title="Restart the Gateway">
    ```bash
    genesis gateway restart
    ```

    Then configure under `plugins.entries.\<id\>.config` in your config file.

  </Step>
</Steps>

If you prefer chat-native control, enable `commands.plugins: true` and use:

```text
/plugin install clawhub:@genesis/voice-call
/plugin show voice-call
/plugin enable voice-call
```

The install path uses the same resolver as the CLI: local path/archive, explicit
`clawhub:<pkg>`, or bare package spec (ClawHub first, then npm fallback).

If config is invalid, install normally fails closed and points you at
`genesis doctor --fix`. The only recovery exception is a narrow bundled-plugin
reinstall path for plugins that opt into
`genesis.install.allowInvalidConfigRecovery`.

Packaged Genesis installs do not eagerly install every bundled plugin's
runtime dependency tree. When a bundled Genesis-owned plugin is active from
plugin config, legacy channel config, or a default-enabled manifest, startup
repairs only that plugin's declared runtime dependencies before importing it.
Explicit disablement still wins: `plugins.entries.<id>.enabled: false`,
`plugins.deny`, `plugins.enabled: false`, and `channels.<id>.enabled: false`
prevent automatic bundled runtime-dependency repair for that plugin/channel.
External plugins and custom load paths must still be installed through
`genesis plugins install`.

## Plugin types

Genesis recognizes two plugin formats:

| Format     | How it works                                                      | Examples                                               |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| **Native** | `genesis.plugin.json` + runtime module; executes in-process       | Official plugins, community npm packages               |
| **Bundle** | Codex/Claude/Cursor-compatible layout; mapped to Genesis features | `.codex-plugin/`, `.claude-plugin/`, `.cursor-plugin/` |

Both show up under `genesis plugins list`. See [Plugin Bundles](/plugins/bundles) for bundle details.

If you are writing a native plugin, start with [Building Plugins](/plugins/building-plugins)
and the [Plugin SDK Overview](/plugins/sdk-overview).

Genesis can load OpenClaw-compatible native plugins that declare package
metadata under `openclaw` and import SDK subpaths from `openclaw/plugin-sdk/*`
or `@openclaw/plugin-sdk/*`.

## Official plugins

### Installable (npm)

| Plugin          | Package               | Docs                                 |
| --------------- | --------------------- | ------------------------------------ |
| Matrix          | `@genesis/matrix`     | [Matrix](/channels/matrix)           |
| Microsoft Teams | `@genesis/msteams`    | [Microsoft Teams](/channels/msteams) |
| Nostr           | `@genesis/nostr`      | [Nostr](/channels/nostr)             |
| Voice Call      | `@genesis/voice-call` | [Voice Call](/plugins/voice-call)    |
| Zalo            | `@genesis/zalo`       | [Zalo](/channels/zalo)               |
| Zalo Personal   | `@genesis/zalouser`   | [Zalo Personal](/plugins/zalouser)   |

### Core (shipped with Genesis)

<AccordionGroup>
  <Accordion title="Model providers (enabled by default)">
    `anthropic`, `byteplus`, `cloudflare-ai-gateway`, `github-copilot`, `google`,
    `huggingface`, `kilocode`, `kimi-coding`, `minimax`, `mistral`, `qwen`,
    `moonshot`, `nvidia`, `openai`, `opencode`, `opencode-go`, `openrouter`,
    `qianfan`, `synthetic`, `together`, `venice`,
    `vercel-ai-gateway`, `volcengine`, `xiaomi`, `zai`
  </Accordion>

  <Accordion title="Memory plugins">
    - `memory-core` — bundled memory search (default via `plugins.slots.memory`)
    - `memory-lancedb` — install-on-demand long-term memory with auto-recall/capture (set `plugins.slots.memory = "memory-lancedb"`)
  </Accordion>

  <Accordion title="Speech providers (enabled by default)">
    `elevenlabs`, `microsoft`
  </Accordion>

  <Accordion title="Other">
    - `browser` — bundled browser plugin for the browser tool, `genesis browser` CLI, `browser.request` gateway method, browser runtime, and default browser control service (enabled by default; disable before replacing it)
    - `copilot-proxy` — VS Code Copilot Proxy bridge (disabled by default)
  </Accordion>
</AccordionGroup>

Looking for third-party plugins? See [Community Plugins](/plugins/community).

## Configuration

```json5
{
  plugins: {
    enabled: true,
    allow: ["voice-call"],
    deny: ["untrusted-plugin"],
    load: { paths: ["~/Projects/oss/voice-call-plugin"] },
    entries: {
      "voice-call": { enabled: true, config: { provider: "twilio" } },
    },
  },
}
```

| Field            | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `enabled`        | Master toggle (default: `true`)                           |
| `allow`          | Plugin allowlist (optional)                               |
| `deny`           | Plugin denylist (optional; deny wins)                     |
| `load.paths`     | Extra plugin files/directories                            |
| `slots`          | Exclusive slot selectors (e.g. `memory`, `contextEngine`) |
| `entries.\<id\>` | Per-plugin toggles + config                               |

Config changes **require a gateway restart**. If the Gateway is running with config
watch + in-process restart enabled (the default `genesis gateway` path), that
restart is usually performed automatically a moment after the config write lands.
There is no supported hot-reload path for native plugin runtime code or lifecycle
hooks; restart the Gateway process that is serving the live channel before
expecting updated `register(api)` code, `api.on(...)` hooks, tools, services, or
provider/runtime hooks to run.

`genesis plugins list` is a local CLI/config snapshot. A `loaded` plugin there
means the plugin is discoverable and loadable from the config/files seen by that
CLI invocation. It does not prove that an already-running remote Gateway child
has restarted into the same plugin code. On VPS/container setups with wrapper
processes, send restarts to the actual `genesis gateway run` process, or use
`genesis gateway restart` against the running Gateway.

<Accordion title="Plugin states: disabled vs missing vs invalid">
  - **Disabled**: plugin exists but enablement rules turned it off. Config is preserved.
  - **Missing**: config references a plugin id that discovery did not find.
  - **Invalid**: plugin exists but its config does not match the declared schema.
</Accordion>

## Discovery and precedence

Genesis scans for plugins in this order (first match wins):

<Steps>
  <Step title="Config paths">
    `plugins.load.paths` — explicit file or directory paths.
  </Step>

  <Step title="Workspace plugins">
    `\<workspace\>/.genesis/<plugin-root>/*.ts` and `\<workspace\>/.genesis/<plugin-root>/*/index.ts`.
  </Step>

  <Step title="Global plugins">
    `~/.genesis/<plugin-root>/*.ts` and `~/.genesis/<plugin-root>/*/index.ts`.
  </Step>

  <Step title="Bundled plugins">
    Shipped with Genesis. Many are enabled by default (model providers, speech).
    Channel plugins and other optional bundled plugins require explicit
    enablement or matching channel configuration.
  </Step>
</Steps>

### Enablement rules

- `plugins.enabled: false` disables all plugins
- `plugins.deny` always wins over allow
- `plugins.entries.\<id\>.enabled: false` disables that plugin
- Workspace-origin plugins are **disabled by default** (must be explicitly enabled)
- Bundled plugins follow the built-in default-on set unless overridden
- Bundled channel plugins stay disabled on a fresh install until channel config,
  env-backed setup, or explicit plugin config selects them
- Exclusive slots can force-enable the selected plugin for that slot
- Some bundled opt-in plugins are enabled automatically when config names a
  plugin-owned surface, such as a provider model ref, channel config, or harness
  runtime
- OpenAI-family Codex routes keep separate plugin boundaries:
  `openai-codex/*` belongs to the OpenAI plugin, while the bundled Codex
  app-server plugin is selected by `embeddedHarness.runtime: "codex"` or legacy
  `codex/*` model refs

## Troubleshooting runtime hooks

If a plugin appears in `plugins list` but `register(api)` side effects or hooks
do not run in live chat traffic, check these first:

- Run `genesis gateway status --deep --require-rpc` and confirm the active
  Gateway URL, profile, config path, and process are the ones you are editing.
- Restart the live Gateway after plugin install/config/code changes. In wrapper
  containers, PID 1 may only be a supervisor; restart or signal the child
  `genesis gateway run` process.
- Use `genesis plugins inspect <id> --json` to confirm hook registrations and
  diagnostics. Non-bundled conversation hooks such as `llm_input`,
  `llm_output`, and `agent_end` need
  `plugins.entries.<id>.hooks.allowConversationAccess=true`.
- For model switching, prefer `before_model_resolve`. It runs before model
  resolution for agent turns; `llm_output` only runs after a model attempt
  produces assistant output.
- For proof of the effective session model, use `genesis sessions` or the
  Gateway session/status surfaces and, when debugging provider payloads, start
  the Gateway with `--raw-stream --raw-stream-path <path>`.

## Plugin slots (exclusive categories)

Some categories are exclusive (only one active at a time):

```json5
{
  plugins: {
    slots: {
      memory: "memory-core", // or "none" to disable
      contextEngine: "legacy", // or a plugin id
    },
  },
}
```

| Slot            | What it controls      | Default             |
| --------------- | --------------------- | ------------------- |
| `memory`        | Active memory plugin  | `memory-core`       |
| `contextEngine` | Active context engine | `legacy` (built-in) |

## CLI reference

```bash
genesis plugins list                       # compact inventory
genesis plugins list --enabled            # only loaded plugins
genesis plugins list --verbose            # per-plugin detail lines
genesis plugins list --json               # machine-readable inventory
genesis plugins inspect <id>              # deep detail
genesis plugins inspect <id> --json       # machine-readable
genesis plugins inspect --all             # fleet-wide table
genesis plugins info <id>                 # inspect alias
genesis plugins doctor                    # diagnostics

genesis plugins install <package>         # install (ClawHub first, then npm)
genesis plugins install clawhub:<pkg>     # install from ClawHub only
genesis plugins install <spec> --force    # overwrite existing install
genesis plugins install <path>            # install from local path
genesis plugins install -l <path>         # link (no copy) for dev
genesis plugins install <plugin> --marketplace <source>
genesis plugins install <plugin> --marketplace https://github.com/<owner>/<repo>
genesis plugins install <spec> --pin      # record exact resolved npm spec
genesis plugins install <spec> --dangerously-force-unsafe-install
genesis plugins update <id-or-npm-spec> # update one plugin
genesis plugins update <id-or-npm-spec> --dangerously-force-unsafe-install
genesis plugins update --all            # update all
genesis plugins uninstall <id>          # remove config/install records
genesis plugins uninstall <id> --keep-files
genesis plugins marketplace list <source>
genesis plugins marketplace list <source> --json

genesis plugins enable <id>
genesis plugins disable <id>
```

Bundled plugins ship with Genesis. Many are enabled by default (for example
bundled model providers, bundled speech providers, and the bundled browser
plugin). Other bundled plugins still need `genesis plugins enable <id>`.

`--force` overwrites an existing installed plugin or hook pack in place. Use
`genesis plugins update <id-or-npm-spec>` for routine upgrades of tracked npm
plugins. It is not supported with `--link`, which reuses the source path instead
of copying over a managed install target.

When `plugins.allow` is already set, `genesis plugins install` adds the
installed plugin id to that allowlist before enabling it, so installs are
immediately loadable after restart.

`genesis plugins update <id-or-npm-spec>` applies to tracked installs. Passing
an npm package spec with a dist-tag or exact version resolves the package name
back to the tracked plugin record and records the new spec for future updates.
Passing the package name without a version moves an exact pinned install back to
the registry's default release line. If the installed npm plugin already matches
the resolved version and recorded artifact identity, Genesis skips the update
without downloading, reinstalling, or rewriting config.

`--pin` is npm-only. It is not supported with `--marketplace`, because
marketplace installs persist marketplace source metadata instead of an npm spec.

`--dangerously-force-unsafe-install` is a break-glass override for false
positives from the built-in dangerous-code scanner. It allows plugin installs
and plugin updates to continue past built-in `critical` findings, but it still
does not bypass plugin `before_install` policy blocks or scan-failure blocking.

This CLI flag applies to plugin install/update flows only. Gateway-backed skill
dependency installs use the matching `dangerouslyForceUnsafeInstall` request
override instead, while `genesis skills install` remains the separate ClawHub
skill download/install flow.

Compatible bundles participate in the same plugin list/inspect/enable/disable
flow. Current runtime support includes bundle skills, Claude command-skills,
Claude `settings.json` defaults, Claude `.lsp.json` and manifest-declared
`lspServers` defaults, Cursor command-skills, and compatible Codex hook
directories.

`genesis plugins inspect <id>` also reports detected bundle capabilities plus
supported or unsupported MCP and LSP server entries for bundle-backed plugins.

Marketplace sources can be a Claude known-marketplace name from
`~/.claude/plugins/known_marketplaces.json`, a local marketplace root or
`marketplace.json` path, a GitHub shorthand like `owner/repo`, a GitHub repo
URL, or a git URL. For remote marketplaces, plugin entries must stay inside the
cloned marketplace repo and use relative path sources only.

See [`genesis plugins` CLI reference](/cli/plugins) for full details.

## Plugin API overview

Native plugins export an entry object that exposes `register(api)`. Older
plugins may still use `activate(api)` as a legacy alias, but new plugins should
use `register`.

```typescript
export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  register(api) {
    api.registerProvider({
      /* ... */
    });
    api.registerTool({
      /* ... */
    });
    api.registerChannel({
      /* ... */
    });
  },
});
```

Genesis loads the entry object and calls `register(api)` during plugin
activation. The loader still falls back to `activate(api)` for older plugins,
but bundled plugins and new external plugins should treat `register` as the
public contract.

`api.registrationMode` tells a plugin why its entry is being loaded:

| Mode            | Meaning                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `full`          | Runtime activation. Register tools, hooks, services, commands, routes, and other live side effects.                              |
| `discovery`     | Read-only capability discovery. Register providers and metadata; trusted plugin entry code may load, but skip live side effects. |
| `setup-only`    | Channel setup metadata loading through a lightweight setup entry.                                                                |
| `setup-runtime` | Channel setup loading that also needs the runtime entry.                                                                         |
| `cli-metadata`  | CLI command metadata collection only.                                                                                            |

Plugin entries that open sockets, databases, background workers, or long-lived
clients should guard those side effects with `api.registrationMode === "full"`.
Discovery loads are cached separately from activating loads and do not replace
the running Gateway registry. Discovery is non-activating, not import-free:
Genesis may evaluate the trusted plugin entry or channel plugin module to build
the snapshot. Keep module top levels lightweight and side-effect-free, and move
network clients, subprocesses, listeners, credential reads, and service startup
behind full-runtime paths.

Common registration methods:

| Method                                  | What it registers           |
| --------------------------------------- | --------------------------- |
| `registerProvider`                      | Model provider (LLM)        |
| `registerChannel`                       | Chat channel                |
| `registerTool`                          | Agent tool                  |
| `registerHook` / `on(...)`              | Lifecycle hooks             |
| `registerSpeechProvider`                | Text-to-speech / STT        |
| `registerRealtimeTranscriptionProvider` | Streaming STT               |
| `registerRealtimeVoiceProvider`         | Duplex realtime voice       |
| `registerMediaUnderstandingProvider`    | Image/audio analysis        |
| `registerImageGenerationProvider`       | Image generation            |
| `registerMusicGenerationProvider`       | Music generation            |
| `registerVideoGenerationProvider`       | Video generation            |
| `registerWebFetchProvider`              | Web fetch / scrape provider |
| `registerWebSearchProvider`             | Web search                  |
| `registerHttpRoute`                     | HTTP endpoint               |
| `registerCommand` / `registerCli`       | CLI commands                |
| `registerContextEngine`                 | Context engine              |
| `registerService`                       | Background service          |

Hook guard behavior for typed lifecycle hooks:

- `before_tool_call`: `{ block: true }` is terminal; lower-priority handlers are skipped.
- `before_tool_call`: `{ block: false }` is a no-op and does not clear an earlier block.
- `before_install`: `{ block: true }` is terminal; lower-priority handlers are skipped.
- `before_install`: `{ block: false }` is a no-op and does not clear an earlier block.
- `message_sending`: `{ cancel: true }` is terminal; lower-priority handlers are skipped.
- `message_sending`: `{ cancel: false }` is a no-op and does not clear an earlier cancel.

Native Codex app-server runs bridge Codex-native tool events back into this
hook surface. Plugins can block native Codex tools through `before_tool_call`,
observe results through `after_tool_call`, and participate in Codex
`PermissionRequest` approvals. The bridge does not rewrite Codex-native tool
arguments yet. The exact Codex runtime support boundary lives in the
[Codex harness v1 support contract](/plugins/codex-harness#v1-support-contract).

For full typed hook behavior, see [SDK overview](/plugins/sdk-overview#hook-decision-semantics).

## Related

- [Building plugins](/plugins/building-plugins) — create your own plugin
- [Plugin bundles](/plugins/bundles) — Codex/Claude/Cursor bundle compatibility
- [Plugin manifest](/plugins/manifest) — manifest schema
- [Registering tools](/plugins/building-plugins#registering-agent-tools) — add agent tools in a plugin
- [Plugin internals](/plugins/architecture) — capability model and load pipeline
- [Community plugins](/plugins/community) — third-party listings
