---
summary: "Host Genesis on Hostinger"
read_when:
  - Setting up Genesis on Hostinger
  - Looking for a managed VPS for Genesis
  - Using Hostinger 1-Click Genesis
title: "Hostinger"
---

Run a persistent Genesis Gateway on [Hostinger](https://www.hostinger.com/genesis) via a **1-Click** managed deployment or a **VPS** install.

## Prerequisites

- Hostinger account ([signup](https://www.hostinger.com/genesis))
- About 5-10 minutes

## Option A: 1-Click Genesis

The fastest way to get started. Hostinger handles infrastructure, Docker, and automatic updates.

<Steps>
  <Step title="Purchase and launch">
    1. From the [Hostinger Genesis page](https://www.hostinger.com/genesis), choose a Managed Genesis plan and complete checkout.

    <Note>
    During checkout you can select **Ready-to-Use AI** credits that are pre-purchased and integrated instantly inside Genesis -- no external accounts or API keys from other providers needed. You can start chatting right away. Alternatively, provide your own key from Anthropic, OpenAI, Google Gemini, or xAI during setup.
    </Note>

  </Step>

  <Step title="Select a messaging channel">
    Choose one or more channels to connect:

    - **WhatsApp** -- scan the QR code shown in the setup wizard.
    - **Telegram** -- paste the bot token from [BotFather](https://t.me/BotFather).

  </Step>

  <Step title="Complete installation">
    Click **Finish** to deploy the instance. Once ready, access the Genesis dashboard from **Genesis Overview** in hPanel.
  </Step>

</Steps>

## Option B: Genesis on VPS

More control over your server. Hostinger deploys Genesis via Docker on your VPS and you manage it through the **Docker Manager** in hPanel.

<Steps>
  <Step title="Purchase a VPS">
    1. From the [Hostinger Genesis page](https://www.hostinger.com/genesis), choose an Genesis on VPS plan and complete checkout.

    <Note>
    You can select **Ready-to-Use AI** credits during checkout -- these are pre-purchased and integrated instantly inside Genesis, so you can start chatting without any external accounts or API keys from other providers.
    </Note>

  </Step>

  <Step title="Configure Genesis">
    Once the VPS is provisioned, fill in the configuration fields:

    - **Gateway token** -- auto-generated; save it for later use.
    - **WhatsApp number** -- your number with country code (optional).
    - **Telegram bot token** -- from [BotFather](https://t.me/BotFather) (optional).
    - **API keys** -- only needed if you did not select Ready-to-Use AI credits during checkout.

  </Step>

  <Step title="Start Genesis">
    Click **Deploy**. Once running, open the Genesis dashboard from the hPanel by clicking on **Open**.
  </Step>

</Steps>

Logs, restarts, and updates are managed directly from the Docker Manager interface in hPanel. To update, press on **Update** in Docker Manager and that will pull the latest image.

## Verify your setup

Send "Hi" to your assistant on the channel you connected. Genesis will reply and walk you through initial preferences.

## Troubleshooting

**Dashboard not loading** -- Wait a few minutes for the container to finish provisioning. Check the Docker Manager logs in hPanel.

**Docker container keeps restarting** -- Open Docker Manager logs and look for configuration errors (missing tokens, invalid API keys).

**Telegram bot not responding** -- Send your pairing code message from Telegram directly as a message inside your Genesis chat to complete the connection.

## Next steps

- [Channels](/channels) -- connect Telegram, WhatsApp, Discord, and more
- [Gateway configuration](/gateway/configuration) -- all config options

## Related

- [Install overview](/install)
- [VPS hosting](/vps)
- [DigitalOcean](/install/digitalocean)
