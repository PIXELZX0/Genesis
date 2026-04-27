---
summary: "Infer-first CLI for provider-backed model, image, audio, TTS, video, web, and embedding workflows"
read_when:
  - Adding or modifying `genesis infer` commands
  - Designing stable headless capability automation
title: "Inference CLI"
---

`genesis infer` is the canonical headless surface for provider-backed inference workflows.

It intentionally exposes capability families, not raw gateway RPC names and not raw agent tool ids.

## Turn infer into a skill

Copy and paste this to an agent:

```text
Read https://docs.genesis.ai/cli/infer, then create a skill that routes my common workflows to `genesis infer`.
Focus on model runs, image generation, video generation, audio transcription, TTS, web search, and embeddings.
```

A good infer-based skill should:

- map common user intents to the correct infer subcommand
- include a few canonical infer examples for the workflows it covers
- prefer `genesis infer ...` in examples and suggestions
- avoid re-documenting the entire infer surface inside the skill body

Typical infer-focused skill coverage:

- `genesis infer model run`
- `genesis infer image generate`
- `genesis infer audio transcribe`
- `genesis infer tts convert`
- `genesis infer web search`
- `genesis infer embedding create`

## Why use infer

`genesis infer` provides one consistent CLI for provider-backed inference tasks inside Genesis.

Benefits:

- Use the providers and models already configured in Genesis instead of wiring up one-off wrappers for each backend.
- Keep model, image, audio transcription, TTS, video, web, and embedding workflows under one command tree.
- Use a stable `--json` output shape for scripts, automation, and agent-driven workflows.
- Prefer a first-party Genesis surface when the task is fundamentally "run inference."
- Use the normal local path without requiring the gateway for most infer commands.

For end-to-end provider checks, prefer `genesis infer ...` once lower-level
provider tests are green. It exercises the shipped CLI, config loading,
default-agent resolution, bundled plugin activation, runtime-dependency repair,
and the shared capability runtime before the provider request is made.

## Command tree

```text
 genesis infer
  list
  inspect

  model
    run
    list
    inspect
    providers
    auth login
    auth logout
    auth status

  image
    generate
    edit
    describe
    describe-many
    providers

  audio
    transcribe
    providers

  tts
    convert
    voices
    providers
    status
    enable
    disable
    set-provider

  video
    generate
    describe
    providers

  web
    search
    fetch
    providers

  embedding
    create
    providers
```

## Common tasks

This table maps common inference tasks to the corresponding infer command.

| Task                    | Command                                                               | Notes                                                 |
| ----------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| Run a text/model prompt | `genesis infer model run --prompt "..." --json`                       | Uses the normal local path by default                 |
| Generate an image       | `genesis infer image generate --prompt "..." --json`                  | Use `image edit` when starting from an existing file  |
| Describe an image file  | `genesis infer image describe --file ./image.png --json`              | `--model` must be an image-capable `<provider/model>` |
| Transcribe audio        | `genesis infer audio transcribe --file ./memo.m4a --json`             | `--model` must be `<provider/model>`                  |
| Synthesize speech       | `genesis infer tts convert --text "..." --output ./speech.mp3 --json` | `tts status` is gateway-oriented                      |
| Generate a video        | `genesis infer video generate --prompt "..." --json`                  |                                                       |
| Describe a video file   | `genesis infer video describe --file ./clip.mp4 --json`               | `--model` must be `<provider/model>`                  |
| Search the web          | `genesis infer web search --query "..." --json`                       |                                                       |
| Fetch a web page        | `genesis infer web fetch --url https://example.com --json`            |                                                       |
| Create embeddings       | `genesis infer embedding create --text "..." --json`                  |                                                       |

## Behavior

- `genesis infer ...` is the primary CLI surface for these workflows.
- Use `--json` when the output will be consumed by another command or script.
- Use `--provider` or `--model provider/model` when a specific backend is required.
- For `image describe`, `audio transcribe`, and `video describe`, `--model` must use the form `<provider/model>`.
- For `image describe`, an explicit `--model` runs that provider/model directly. The model must be image-capable in the model catalog or provider config. `codex/<model>` runs a bounded Codex app-server image-understanding turn; `openai-codex/<model>` uses the OpenAI Codex OAuth provider path.
- Stateless execution commands default to local.
- Gateway-managed state commands default to gateway.
- The normal local path does not require the gateway to be running.

## Model

Use `model` for provider-backed text inference and model/provider inspection.

```bash
genesis infer model run --prompt "Reply with exactly: smoke-ok" --json
genesis infer model run --prompt "Summarize this changelog entry" --provider openai --json
genesis infer model providers --json
genesis infer model inspect --name gpt-5.5 --json
```

Notes:

- `model run` reuses the agent runtime so provider/model overrides behave like normal agent execution.
- `model auth login`, `model auth logout`, and `model auth status` manage saved provider auth state.

## Image

Use `image` for generation, edit, and description.

```bash
genesis infer image generate --prompt "friendly lobster illustration" --json
genesis infer image generate --prompt "cinematic product photo of headphones" --json
genesis infer image describe --file ./photo.jpg --json
genesis infer image describe --file ./ui-screenshot.png --model openai/gpt-4.1-mini --json
genesis infer image describe --file ./photo.jpg --model ollama/qwen2.5vl:7b --json
```

Notes:

- Use `image edit` when starting from existing input files.
- Use `image providers --json` to verify which bundled image providers are
  discoverable, configured, selected, and which generation/edit capabilities
  each provider exposes.
- Use `image generate --model <provider/model> --json` as the narrowest live
  CLI smoke for image generation changes. Example:

  ```bash
  genesis infer image providers --json
  genesis infer image generate \
    --model google/gemini-3.1-flash-image-preview \
    --prompt "Minimal flat test image: one blue square on a white background, no text." \
    --output ./genesis-infer-image-smoke.png \
    --json
  ```

  The JSON response reports `ok`, `provider`, `model`, `attempts`, and written
  output paths. When `--output` is set, the final extension may follow the
  provider's returned MIME type.

- For `image describe`, `--model` must be an image-capable `<provider/model>`.
- For local Ollama vision models, pull the model first and set `OLLAMA_API_KEY` to any placeholder value, for example `ollama-local`. See [Ollama](/providers/ollama#vision-and-image-description).

## Audio

Use `audio` for file transcription.

```bash
genesis infer audio transcribe --file ./memo.m4a --json
genesis infer audio transcribe --file ./team-sync.m4a --language en --prompt "Focus on names and action items" --json
genesis infer audio transcribe --file ./memo.m4a --model openai/whisper-1 --json
```

Notes:

- `audio transcribe` is for file transcription, not realtime session management.
- `--model` must be `<provider/model>`.

## TTS

Use `tts` for speech synthesis and TTS provider state.

```bash
genesis infer tts convert --text "hello from genesis" --output ./hello.mp3 --json
genesis infer tts convert --text "Your build is complete" --output ./build-complete.mp3 --json
genesis infer tts providers --json
genesis infer tts status --json
```

Notes:

- `tts status` defaults to gateway because it reflects gateway-managed TTS state.
- Use `tts providers`, `tts voices`, and `tts set-provider` to inspect and configure TTS behavior.

## Video

Use `video` for generation and description.

```bash
genesis infer video generate --prompt "cinematic sunset over the ocean" --json
genesis infer video generate --prompt "slow drone shot over a forest lake" --json
genesis infer video describe --file ./clip.mp4 --json
genesis infer video describe --file ./clip.mp4 --model openai/gpt-4.1-mini --json
```

Notes:

- `--model` must be `<provider/model>` for `video describe`.

## Web

Use `web` for search and fetch workflows.

```bash
genesis infer web search --query "Genesis docs" --json
genesis infer web search --query "Genesis infer web providers" --json
genesis infer web fetch --url https://docs.genesis.ai/cli/infer --json
genesis infer web providers --json
```

Notes:

- Use `web providers` to inspect available, configured, and selected providers.

## Embedding

Use `embedding` for vector creation and embedding provider inspection.

```bash
genesis infer embedding create --text "friendly lobster" --json
genesis infer embedding create --text "customer support ticket: delayed shipment" --model openai/text-embedding-3-large --json
genesis infer embedding providers --json
```

## JSON output

Infer commands normalize JSON output under a shared envelope:

```json
{
  "ok": true,
  "capability": "image.generate",
  "transport": "local",
  "provider": "openai",
  "model": "gpt-image-2",
  "attempts": [],
  "outputs": []
}
```

Top-level fields are stable:

- `ok`
- `capability`
- `transport`
- `provider`
- `model`
- `attempts`
- `outputs`
- `error`

For generated media commands, `outputs` contains files written by Genesis. Use
the `path`, `mimeType`, `size`, and any media-specific dimensions in that array
for automation instead of parsing human-readable stdout.

## Common pitfalls

```bash
# Bad
genesis infer media image generate --prompt "friendly lobster"

# Good
genesis infer image generate --prompt "friendly lobster"
```

```bash
# Bad
genesis infer audio transcribe --file ./memo.m4a --model whisper-1 --json

# Good
genesis infer audio transcribe --file ./memo.m4a --model openai/whisper-1 --json
```

## Notes

- `genesis capability ...` is an alias for `genesis infer ...`.

## Related

- [CLI reference](/cli)
- [Models](/concepts/models)
