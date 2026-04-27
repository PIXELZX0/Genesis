---
summary: "Use OpenRouter's unified API to access many models in Genesis"
read_when:
  - You want a single API key for many LLMs
  - You want to run models via OpenRouter in Genesis
  - You want to use OpenRouter for image generation
title: "OpenRouter"
---

OpenRouter provides a **unified API** that routes requests to many models behind a single
endpoint and API key. It is OpenAI-compatible, so most OpenAI SDKs work by switching the base URL.

## Getting started

<Steps>
  <Step title="Get your API key">
    Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys).
  </Step>
  <Step title="Run onboarding">
    ```bash
    genesis onboard --auth-choice openrouter-api-key
    ```
  </Step>
  <Step title="(Optional) Switch to a specific model">
    Onboarding defaults to `openrouter/auto`. Pick a concrete model later:

    ```bash
    genesis models set openrouter/<provider>/<model>
    ```

  </Step>
</Steps>

## Config example

```json5
{
  env: { OPENROUTER_API_KEY: "sk-or-..." },
  agents: {
    defaults: {
      model: { primary: "openrouter/auto" },
    },
  },
}
```

## Model references

<Note>
Model refs follow the pattern `openrouter/<provider>/<model>`. For the full list of
available providers and models, see [/concepts/model-providers](/concepts/model-providers).
</Note>

Bundled fallback examples:

| Model ref                            | Notes                         |
| ------------------------------------ | ----------------------------- |
| `openrouter/auto`                    | OpenRouter automatic routing  |
| `openrouter/moonshotai/kimi-k2.6`    | Kimi K2.6 via MoonshotAI      |
| `openrouter/openrouter/healer-alpha` | OpenRouter Healer Alpha route |
| `openrouter/openrouter/hunter-alpha` | OpenRouter Hunter Alpha route |

## Image generation

OpenRouter can also back the `image_generate` tool. Use an OpenRouter image model under `agents.defaults.imageGenerationModel`:

```json5
{
  env: { OPENROUTER_API_KEY: "sk-or-..." },
  agents: {
    defaults: {
      imageGenerationModel: {
        primary: "openrouter/google/gemini-3.1-flash-image-preview",
      },
    },
  },
}
```

Genesis sends image requests to OpenRouter's chat completions image API with `modalities: ["image", "text"]`. Gemini image models receive supported `aspectRatio` and `resolution` hints through OpenRouter's `image_config`.

## Text-to-speech

OpenRouter can also be used as a TTS provider through its OpenAI-compatible
`/audio/speech` endpoint.

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "openrouter",
      providers: {
        openrouter: {
          model: "hexgrad/kokoro-82m",
          voice: "af_alloy",
          responseFormat: "mp3",
        },
      },
    },
  },
}
```

If `messages.tts.providers.openrouter.apiKey` is omitted, TTS reuses
`models.providers.openrouter.apiKey`, then `OPENROUTER_API_KEY`.

## Authentication and headers

OpenRouter uses a Bearer token with your API key under the hood.

On real OpenRouter requests (`https://openrouter.ai/api/v1`), Genesis also adds
OpenRouter's documented app-attribution headers:

| Header                    | Value                |
| ------------------------- | -------------------- |
| `HTTP-Referer`            | `https://genesis.ai` |
| `X-OpenRouter-Title`      | `Genesis`            |
| `X-OpenRouter-Categories` | `cli-agent`          |

<Warning>
If you repoint the OpenRouter provider at some other proxy or base URL, Genesis
does **not** inject those OpenRouter-specific headers or Anthropic cache markers.
</Warning>

## Advanced configuration

<AccordionGroup>
  <Accordion title="Anthropic cache markers">
    On verified OpenRouter routes, Anthropic model refs keep the
    OpenRouter-specific Anthropic `cache_control` markers that Genesis uses for
    better prompt-cache reuse on system/developer prompt blocks.
  </Accordion>

  <Accordion title="Thinking / reasoning injection">
    On supported non-`auto` routes, Genesis maps the selected thinking level to
    OpenRouter proxy reasoning payloads. Unsupported model hints and
    `openrouter/auto` skip that reasoning injection.
  </Accordion>

  <Accordion title="OpenAI-only request shaping">
    OpenRouter still runs through the proxy-style OpenAI-compatible path, so
    native OpenAI-only request shaping such as `serviceTier`, Responses `store`,
    OpenAI reasoning-compat payloads, and prompt-cache hints is not forwarded.
  </Accordion>

  <Accordion title="Gemini-backed routes">
    Gemini-backed OpenRouter refs stay on the proxy-Gemini path: Genesis keeps
    Gemini thought-signature sanitation there, but does not enable native Gemini
    replay validation or bootstrap rewrites.
  </Accordion>

  <Accordion title="Provider routing metadata">
    If you pass OpenRouter provider routing under model params, Genesis forwards
    it as OpenRouter routing metadata before the shared stream wrappers run.
  </Accordion>
</AccordionGroup>

## Related

<CardGroup cols={2}>
  <Card title="Model selection" href="/concepts/model-providers" icon="layers">
    Choosing providers, model refs, and failover behavior.
  </Card>
  <Card title="Configuration reference" href="/gateway/configuration-reference" icon="gear">
    Full config reference for agents, models, and providers.
  </Card>
</CardGroup>
