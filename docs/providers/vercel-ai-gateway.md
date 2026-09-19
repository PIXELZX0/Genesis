---
summary: "Vercel AI Gateway setup (auth + model selection)"
title: "Vercel AI gateway"
read_when:
  - You want to use Vercel AI Gateway with Genesis
  - You need the API key env var or CLI auth choice
---

The [Vercel AI Gateway](https://vercel.com/ai-gateway) provides a unified API to
access hundreds of models through a single endpoint.

| Property      | Value                            |
| ------------- | -------------------------------- |
| Provider      | `vercel-ai-gateway`              |
| Auth          | `AI_GATEWAY_API_KEY`             |
| API           | Anthropic Messages compatible    |
| Model catalog | Auto-discovered via `/v1/models` |

<Tip>
Genesis auto-discovers the Gateway `/v1/models` catalog, so
`/models vercel-ai-gateway` includes current model refs such as
`vercel-ai-gateway/openai/gpt-5.5` and
`vercel-ai-gateway/moonshotai/kimi-k2.6`.
</Tip>

## Getting started

<Steps>
  <Step title="Set the API key">
    Run onboarding and choose the AI Gateway auth option:

    ```bash
    genesis onboard --auth-choice ai-gateway-api-key
    ```

  </Step>
  <Step title="Set a default model">
    Add the model to your Genesis config:

    ```json5
    {
      agents: {
        defaults: {
          model: { primary: "vercel-ai-gateway/anthropic/claude-opus-4.6" },
        },
      },
    }
    ```

  </Step>
  <Step title="Verify the model is available">
    ```bash
    genesis models list --provider vercel-ai-gateway
    ```
  </Step>
</Steps>

## Non-interactive example

For scripted or CI setups, pass all values on the command line:

```bash
genesis onboard --non-interactive \
  --mode local \
  --auth-choice ai-gateway-api-key \
  --ai-gateway-api-key "$AI_GATEWAY_API_KEY"
```

## Model ID shorthand

Genesis accepts Vercel Claude shorthand model refs and normalizes them at
runtime:

| Shorthand input                     | Normalized model ref                          |
| ----------------------------------- | --------------------------------------------- |
| `vercel-ai-gateway/claude-opus-4.6` | `vercel-ai-gateway/anthropic/claude-opus-4.6` |
| `vercel-ai-gateway/opus-4.6`        | `vercel-ai-gateway/anthropic/claude-opus-4-6` |

<Tip>
You can use either the shorthand or the fully qualified model ref in your
configuration. Genesis resolves the canonical form automatically.
</Tip>

## Jev tool router

[TypeSafe Jev](https://typesafe.ai) (`typesafe-ai/jev` on Vercel AI Gateway) is
an evaluation model. It takes state plus typed questions and returns
probabilities. It cannot chat, write text, or call tools, so it is not
selectable as a chat model. Genesis uses it in two opt-in ways:

- **Tool router.** Before each model call in the agent loop, Jev picks the next
  step from the agent's tools (or "reply in text"):
  - If every parameter of the chosen tool is an enum, const, or boolean, Jev
    picks the arguments and the tool runs without an LLM call.
  - If the tool needs free-form arguments (paths, commands, URLs, text), the
    main model is called with that tool forced and only writes the arguments.
  - If Jev picks a text reply, the main model is called with tools disabled.
  - Low-confidence answers, errors, and timeouts fall back to a normal model
    call.
- **`jev_evaluate` tool.** Lets the agent ask Jev boolean, choice, and score
  questions directly. It is optional, so add it to the tool allowlist.

```json5
{
  plugins: {
    entries: {
      "vercel-ai-gateway": {
        config: {
          jevRouter: {
            enabled: true,
            minConfidence: 0.6, // below this, the model decides
            maxConsecutiveDirectCalls: 8, // model-free tool calls in a row per run
            timeoutMs: 3000,
          },
        },
      },
    },
  },
  tools: { alsoAllow: ["jev_evaluate"] },
}
```

In the Control UI, open **Config → Plugins → Vercel AI Gateway Provider** and
switch **Enable Jev tool router** on or off. Plugin config changes take effect
after a gateway restart; the Control UI offers to restart when you apply.

The router works with any main model and provider; only Jev itself goes through
Vercel AI Gateway, using the same `AI_GATEWAY_API_KEY`.

<Warning>
Tool results (for example web page text) become part of the state Jev reads, and
Jev does not treat that content as untrusted. Model-free calls are limited to
closed-set arguments and still pass through tool policy, `before_tool_call`
hooks, and approvals. Keep approvals on for tools with side effects.
</Warning>

## Advanced configuration

<AccordionGroup>
  <Accordion title="Environment variable for daemon processes">
    If the Genesis Gateway runs as a daemon (launchd/systemd), make sure
    `AI_GATEWAY_API_KEY` is available to that process.

    <Warning>
    A key set only in `~/.profile` will not be visible to a launchd/systemd
    daemon unless that environment is explicitly imported. Set the key in
    `~/.genesis/.env` or via `env.shellEnv` to ensure the gateway process can
    read it.
    </Warning>

  </Accordion>

  <Accordion title="Provider routing">
    Vercel AI Gateway routes requests to the upstream provider based on the model
    ref prefix. For example, `vercel-ai-gateway/anthropic/claude-opus-4.6` routes
    through Anthropic, while `vercel-ai-gateway/openai/gpt-5.5` routes through
    OpenAI and `vercel-ai-gateway/moonshotai/kimi-k2.6` routes through
    MoonshotAI. Your single `AI_GATEWAY_API_KEY` handles authentication for all
    upstream providers.
  </Accordion>
</AccordionGroup>

## Related

<CardGroup cols={2}>
  <Card title="Model selection" href="/concepts/model-providers" icon="layers">
    Choosing providers, model refs, and failover behavior.
  </Card>
  <Card title="Troubleshooting" href="/help/troubleshooting" icon="wrench">
    General troubleshooting and FAQ.
  </Card>
</CardGroup>
