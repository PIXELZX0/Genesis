---
summary: "Run Genesis through LiteLLM Proxy for unified model access and cost tracking"
title: "LiteLLM"
read_when:
  - You want to route Genesis through a LiteLLM proxy
  - You need cost tracking, logging, or model routing through LiteLLM
---

[LiteLLM](https://litellm.ai) is an open-source LLM gateway that provides a unified API to 100+ model providers. Route Genesis through LiteLLM to get centralized cost tracking, logging, and the flexibility to switch backends without changing your Genesis config.

<Tip>
**Why use LiteLLM with Genesis?**

- **Cost tracking** — See exactly what Genesis spends across all models
- **Model routing** — Switch between Claude, GPT-4, Gemini, Bedrock without config changes
- **Virtual keys** — Create keys with spend limits for Genesis
- **Logging** — Full request/response logs for debugging
- **Fallbacks** — Automatic failover if your primary provider is down

</Tip>

## Quick start

<Tabs>
  <Tab title="Onboarding (recommended)">
    **Best for:** fastest path to a working LiteLLM setup.

    <Steps>
      <Step title="Run onboarding">
        ```bash
        genesis onboard --auth-choice litellm-api-key
        ```
      </Step>
    </Steps>

  </Tab>

  <Tab title="Manual setup">
    **Best for:** full control over installation and config.

    <Steps>
      <Step title="Start LiteLLM Proxy">
        ```bash
        pip install 'litellm[proxy]'
        litellm --model claude-opus-4-6
        ```
      </Step>
      <Step title="Point Genesis to LiteLLM">
        ```bash
        export LITELLM_API_KEY="your-litellm-key"

        genesis
        ```

        That's it. Genesis now routes through LiteLLM.
      </Step>
    </Steps>

  </Tab>
</Tabs>

## Configuration

### Environment variables

```bash
export LITELLM_API_KEY="sk-litellm-key"
```

### Config file

```json5
{
  models: {
    providers: {
      litellm: {
        baseUrl: "http://localhost:4000",
        apiKey: "${LITELLM_API_KEY}",
        api: "openai-completions",
        models: [
          {
            id: "claude-opus-4-6",
            name: "Claude Opus 4.6",
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 200000,
            maxTokens: 64000,
          },
          {
            id: "gpt-4o",
            name: "GPT-4o",
            reasoning: false,
            input: ["text", "image"],
            contextWindow: 128000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "litellm/claude-opus-4-6" },
    },
  },
}
```

## Advanced configuration

<AccordionGroup>
  <Accordion title="Virtual keys">
    Create a dedicated key for Genesis with spend limits:

    ```bash
    curl -X POST "http://localhost:4000/key/generate" \
      -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "key_alias": "genesis",
        "max_budget": 50.00,
        "budget_duration": "monthly"
      }'
    ```

    Use the generated key as `LITELLM_API_KEY`.

  </Accordion>

  <Accordion title="Model routing">
    LiteLLM can route model requests to different backends. Configure in your LiteLLM `config.yaml`:

    ```yaml
    model_list:
      - model_name: claude-opus-4-6
        litellm_params:
          model: claude-opus-4-6
          api_key: os.environ/ANTHROPIC_API_KEY

      - model_name: gpt-4o
        litellm_params:
          model: gpt-4o
          api_key: os.environ/OPENAI_API_KEY
    ```

    Genesis keeps requesting `claude-opus-4-6` — LiteLLM handles the routing.

  </Accordion>

  <Accordion title="Viewing usage">
    Check LiteLLM's dashboard or API:

    ```bash
    # Key info
    curl "http://localhost:4000/key/info" \
      -H "Authorization: Bearer sk-litellm-key"

    # Spend logs
    curl "http://localhost:4000/spend/logs" \
      -H "Authorization: Bearer $LITELLM_MASTER_KEY"
    ```

  </Accordion>

  <Accordion title="Proxy behavior notes">
    - LiteLLM runs on `http://localhost:4000` by default
    - Genesis connects through LiteLLM's proxy-style OpenAI-compatible `/v1`
      endpoint
    - Native OpenAI-only request shaping does not apply through LiteLLM:
      no `service_tier`, no Responses `store`, no prompt-cache hints, and no
      OpenAI reasoning-compat payload shaping
    - Hidden Genesis attribution headers (`originator`, `version`, `User-Agent`)
      are not injected on custom LiteLLM base URLs
  </Accordion>
</AccordionGroup>

<Note>
For general provider configuration and failover behavior, see [Model Providers](/concepts/model-providers).
</Note>

## Related

<CardGroup cols={2}>
  <Card title="LiteLLM Docs" href="https://docs.litellm.ai" icon="book">
    Official LiteLLM documentation and API reference.
  </Card>
  <Card title="Model selection" href="/concepts/model-providers" icon="layers">
    Overview of all providers, model refs, and failover behavior.
  </Card>
  <Card title="Configuration" href="/gateway/configuration" icon="gear">
    Full config reference.
  </Card>
  <Card title="Model selection" href="/concepts/models" icon="brain">
    How to choose and configure models.
  </Card>
</CardGroup>
