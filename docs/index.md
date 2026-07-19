---
summary: "Genesis is a self-hosted gateway that connects chat apps to AI agents."
read_when:
  - Introducing Genesis to newcomers
title: "Genesis"
---

# Genesis

<p align="center">
    <img
        src="/assets/genesis-logo-text-dark.png"
        alt="Genesis"
        width="500"
        class="dark:hidden"
    />
    <img
        src="/assets/genesis-logo-text.png"
        alt="Genesis"
        width="500"
        class="hidden dark:block"
    />
</p>

<p align="center">
  <strong>One self-hosted gateway. Your favorite chat apps. An AI assistant that is always on.</strong><br />
  Run Genesis on your own machine and message it from Discord, Google Chat, iMessage, Matrix, Microsoft Teams, Signal, Slack, Telegram, WhatsApp, Zalo, and more.
</p>

<p align="center">
  <a href="/start/getting-started"><strong>Get started</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="/start/showcase">See what people build</a>
  &nbsp;&middot;&nbsp;
  <a href="https://github.com/PIXELZX0/Genesis">GitHub</a>
</p>

<Info>
  New here? The shortest path is `npm install -g @pixelzx/genesis@latest` then `genesis onboard`. Five minutes to a working assistant.
</Info>

## What Genesis is

Genesis is a **local-first control plane** that sits between your chat apps and an AI agent. You start one Gateway process, connect the channels you already use, and the same agent answers from your phone, your terminal, or a browser dashboard.

<Columns cols={2}>
  <Card title="You stay in control" icon="lock">
    The Gateway runs on hardware you own. Your messages, sessions, and credentials never leave your machine unless you point them at a remote host.
  </Card>
  <Card title="One agent, many channels" icon="network">
    Discord, iMessage, Signal, Slack, Telegram, WhatsApp, and more share a single session, memory, and tool surface. No per-channel bots to maintain.
  </Card>
  <Card title="Agent-native by design" icon="cpu">
    Built for coding and tool-using agents: workspace isolation, multi-agent routing, session memory, and approval gates out of the box.
  </Card>
  <Card title="Extensible through plugins" icon="plug">
    Add channels, providers, or skills as plugins. Bundled plugins ship with Genesis, and you can drop in your own.
  </Card>
</Columns>

## Run it in three steps

<Steps>
  <Step title="Install">
    Requires Node 24 (recommended) or Node 22 LTS (`22.14+`).

    ```bash
    npm install -g @pixelzx/genesis@latest
    ```

  </Step>
  <Step title="Onboard">
    The wizard installs the Gateway as a system service, sets up your workspace, and walks you through pairing your first channel.

    ```bash
    genesis onboard --install-daemon
    ```

  </Step>
  <Step title="Chat">
    Open the dashboard locally, or message the bot from a paired channel like Telegram.

    ```bash
    genesis dashboard
    # open http://127.0.0.1:18789/
    ```

    Need remote access? See [Web surfaces](/web) and [Tailscale](/gateway/tailscale).

  </Step>
</Steps>

Full developer setup, dev-loop, and source build instructions live in [Getting started](/start/getting-started).

## Channels

Pair any of these. Each is a first-class channel with its own pairing flow and configuration.

<Columns cols={4}>
  <Card title="Discord" href="/channels/discord" />
  <Card title="Google Chat" href="/channels/googlechat" />
  <Card title="iMessage" href="/channels/imessage" />
  <Card title="Matrix" href="/channels/matrix" />
  <Card title="Microsoft Teams" href="/channels/msteams" />
  <Card title="Signal" href="/channels/signal" />
  <Card title="Slack" href="/channels/slack" />
  <Card title="Telegram" href="/channels/telegram" />
  <Card title="WhatsApp" href="/channels/whatsapp" />
  <Card title="Zalo" href="/channels/zalo" />
  <Card title="WebChat" href="/web/webchat" />
  <Card title="All channels" href="/channels" />
</Columns>

## What it can do

<Columns cols={2}>
  <Card title="Multi-agent routing" icon="route" href="/concepts/multi-agent">
    Run isolated agents per channel, workspace, or sender. Each agent keeps its own session, memory, and tool policy.
  </Card>
  <Card title="Live canvas and voice" icon="monitor" href="/nodes">
    Pair iOS and Android nodes for Canvas, camera, voice wake, and push-to-talk. The agent drives a visual surface you control.
  </Card>
  <Card title="Sandbox and approvals" icon="shield" href="/gateway/sandboxing">
    Lock down non-main sessions with Docker, SSH, or OpenShell backends. Approve sensitive tool calls before they run.
  </Card>
  <Card title="Cron, hooks, and skills" icon="list-checks" href="/automation">
    Schedule recurring jobs, react to events with hooks, and teach the agent new skills with markdown files.
  </Card>
</Columns>

## See it in the wild

People ship real things on Genesis: PR review loops, mobile apps, home automation, voice systems, and chat-native devtools.

<Card title="Browse the showcase" href="/start/showcase" icon="sparkles" horizontal>
  Watch walkthroughs, read project breakdowns, and get a feel for what is possible.
</Card>

## Go further

<Columns cols={3}>
  <Card title="Install on a server" href="/install" icon="server">
    Docker, Nix, Ansible, Fly, Hetzner, Railway, GCP, Azure, and more.
  </Card>
  <Card title="Configure the Gateway" href="/gateway/configuration" icon="settings">
    Tokens, providers, agents, channels, and the full configuration reference.
  </Card>
  <Card title="Build a plugin" href="/plugins/building-plugins" icon="code">
    Add a channel, a provider, or a skill. The SDK and manifest format are documented.
  </Card>
  <Card title="Understand the architecture" href="/concepts/architecture" icon="git-branch">
    Sessions, routing, the Gateway, and how the pieces fit together.
  </Card>
  <Card title="Troubleshoot" href="/help/troubleshooting" icon="life-buoy">
    Common errors, logging, and the `genesis doctor` workflow.
  </Card>
  <Card title="Join the community" href="https://discord.gg/clawd" icon="users">
    Discord for support, showcase, and shipping together.
  </Card>
</Columns>
