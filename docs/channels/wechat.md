---
summary: "WeChat channel setup through the external genesis-weixin plugin"
read_when:
  - You want to connect Genesis to WeChat or Weixin
  - You are installing or troubleshooting the genesis-weixin channel plugin
  - You need to understand how external channel plugins run beside the Gateway
title: "WeChat"
---

Genesis connects to WeChat through Tencent's external
`@tencent-weixin/genesis-weixin` channel plugin.

Status: external plugin. Direct chats and media are supported. Group chats are not
advertised by the current plugin capability metadata.

## Naming

- **WeChat** is the user-facing name in these docs.
- **Weixin** is the name used by Tencent's package and by the plugin id.
- `genesis-weixin` is the Genesis channel id.
- `@tencent-weixin/genesis-weixin` is the npm package.

Use `genesis-weixin` in CLI commands and config paths.

## How it works

The WeChat code does not live in the Genesis core repo. Genesis provides the
generic channel plugin contract, and the external plugin provides the
WeChat-specific runtime:

1. `genesis plugins install` installs `@tencent-weixin/genesis-weixin`.
2. The Gateway discovers the plugin manifest and loads the plugin entrypoint.
3. The plugin registers channel id `genesis-weixin`.
4. `genesis channels login --channel genesis-weixin` starts QR login.
5. The plugin stores account credentials under the Genesis state directory.
6. When the Gateway starts, the plugin starts its Weixin monitor for each
   configured account.
7. Inbound WeChat messages are normalized through the channel contract, routed to
   the selected Genesis agent, and sent back through the plugin outbound path.

That separation matters: Genesis core should stay channel-agnostic. WeChat login,
Tencent iLink API calls, media upload/download, context tokens, and account
monitoring are owned by the external plugin.

## Install

Quick install:

```bash
npx -y @tencent-weixin/genesis-weixin-cli install
```

Manual install:

```bash
genesis plugins install "@tencent-weixin/genesis-weixin"
genesis config set plugins.entries.genesis-weixin.enabled true
```

Restart the Gateway after install:

```bash
genesis gateway restart
```

## Login

Run QR login on the same machine that runs the Gateway:

```bash
genesis channels login --channel genesis-weixin
```

Scan the QR code with WeChat on your phone and confirm the login. The plugin saves
the account token locally after a successful scan.

To add another WeChat account, run the same login command again. For multiple
accounts, isolate direct-message sessions by account, channel, and sender:

```bash
genesis config set session.dmScope per-account-channel-peer
```

## Access control

Direct messages use the normal Genesis pairing and allowlist model for channel
plugins.

Approve new senders:

```bash
genesis pairing list genesis-weixin
genesis pairing approve genesis-weixin <CODE>
```

For the full access-control model, see [Pairing](/channels/pairing).

## Compatibility

The plugin checks the host Genesis version at startup.

| Plugin line | Genesis version         | npm tag  |
| ----------- | ----------------------- | -------- |
| `2.x`       | `>=2026.3.22`           | `latest` |
| `1.x`       | `>=2026.1.0 <2026.3.22` | `legacy` |

If the plugin reports that your Genesis version is too old, either update
Genesis or install the legacy plugin line:

```bash
genesis plugins install @tencent-weixin/genesis-weixin@legacy
```

## Sidecar process

The WeChat plugin can run helper work beside the Gateway while it monitors the
Tencent iLink API. In issue #68451, that helper path exposed a bug in Genesis's
generic stale-Gateway cleanup: a child process could try to clean up the parent
Gateway process, causing restart loops under process managers such as systemd.

Current Genesis startup cleanup excludes the current process and its ancestors,
so a channel helper must not kill the Gateway that launched it. This fix is
generic; it is not a WeChat-specific path in core.

## Troubleshooting

Check install and status:

```bash
genesis plugins list
genesis channels status --probe
genesis --version
```

If the channel shows as installed but does not connect, confirm that the plugin is
enabled and restart:

```bash
genesis config set plugins.entries.genesis-weixin.enabled true
genesis gateway restart
```

If the Gateway restarts repeatedly after enabling WeChat, update both Genesis and
the plugin:

```bash
npm view @tencent-weixin/genesis-weixin version
genesis plugins install "@tencent-weixin/genesis-weixin" --force
genesis gateway restart
```

Temporary disable:

```bash
genesis config set plugins.entries.genesis-weixin.enabled false
genesis gateway restart
```

## Related docs

- Channel overview: [Chat Channels](/channels)
- Pairing: [Pairing](/channels/pairing)
- Channel routing: [Channel Routing](/channels/channel-routing)
- Plugin architecture: [Plugin Architecture](/plugins/architecture)
- Channel plugin SDK: [Channel Plugin SDK](/plugins/sdk-channel-plugins)
- External package: [@tencent-weixin/genesis-weixin](https://www.npmjs.com/package/@tencent-weixin/genesis-weixin)
