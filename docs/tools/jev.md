---
summary: "TypeSafe Jev evaluation tool and model-call tool router"
read_when:
  - You want fast typed judgments (yes/no, choice, score) inside an agent
  - You want Jev to pick tools so the main model only writes text
  - You are choosing between TypeSafe, OpenRouter, and Vercel AI Gateway for Jev
title: "TypeSafe Jev"
---

[TypeSafe Jev](https://docs.typesafe.ai/introduction) is an evaluation model.
It takes state plus typed questions and returns calibrated probabilities. It
cannot chat, write text, or call tools, so it is not a chat model in Genesis.
The bundled `typesafe` plugin uses it in two opt-in ways:

- **Tool router.** Before each model call in the agent loop, Jev picks the next
  step from the agent's tools (or "reply in text"). Argument questions for
  enum/boolean-only tools go in the same request, so one round trip decides
  the whole call.
  - If every parameter of the chosen tool is an enum, const, or boolean, the
    tool runs without an LLM call.
  - If the tool needs free-form arguments (paths, commands, URLs, text), the
    main model is called with that tool forced and only writes the arguments.
  - **Browser:** Jev reads the numbered elements (`[ref=eN]`) from the latest
    browser snapshot and, in the same request, picks the browser step and the
    element to click. Clicks and fresh snapshots run without an LLM call.
    Typing, navigation, and other browser steps go to the main model.
  - If Jev picks a text reply, the main model is called with tools disabled.
  - Low-confidence answers, errors, and timeouts fall back to a normal model
    call.
- **`jev_evaluate` tool.** Lets the agent ask Jev boolean, choice, and score
  questions directly.

## Backends

| Backend             | Endpoint                                              | Key                                              |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| `typesafe`          | `https://api.typesafe.ai/v1/systemone`                | `apiKey` in plugin config, or `TYPESAFE_API_KEY` |
| `vercel-ai-gateway` | `https://ai-gateway.vercel.sh/v4/ai/evaluation-model` | Vercel AI Gateway provider key                   |
| `openrouter`        | `https://openrouter.ai/api/alpha/decisions` (alpha)   | OpenRouter provider key                          |

`backend: "auto"` (default) uses the first backend with a key, in the order
above. Vercel and OpenRouter reuse the keys you already configured for those
providers.

## Configure

In the Control UI, open **Config → Plugins → TypeSafe Jev**, pick the backend,
and switch **Enable Jev tool router** on or off. Turning the router on needs a
gateway restart (the Control UI offers one when you apply). Turning it off,
switching backends, and changing thresholds apply to the next model call.

```json5
{
  plugins: {
    entries: {
      typesafe: {
        config: {
          backend: "auto", // or "typesafe" | "vercel-ai-gateway" | "openrouter"
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
  // jev_evaluate is optional, so allowlist it explicitly.
  tools: { alsoAllow: ["jev_evaluate"] },
}
```

The router works with any main model and provider.

<Warning>
Tool results (for example web page text) become part of the state Jev reads, and
Jev does not treat that content as untrusted. Model-free calls are limited to
closed-set arguments and snapshot elements, and still pass through tool policy,
`before_tool_call` hooks, and approvals. A browser click is a side effect: a
hostile page can steer which element looks right. Keep approvals on for tools
with side effects and lower `maxConsecutiveDirectCalls` for untrusted sites.
</Warning>

## Related

- [Plugin hooks: `before_model_call`](/plugins/hooks)
- [Vercel AI Gateway](/providers/vercel-ai-gateway)
- [OpenRouter](/providers/openrouter)
