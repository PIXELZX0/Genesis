---
summary: "Voice Agent plugin: talk to an agent through the gateway host's or a paired node's microphone and speaker"
read_when:
  - You want to talk to an agent hands-free from the gateway machine or a node
  - You are configuring ElevenLabs Scribe v2 Realtime for spoken agent turns
title: "Voice agent plugin"
---

The Voice Agent plugin turns a microphone and speaker into an agent surface.
It listens continuously, transcribes speech with a realtime transcription
provider, runs an agent turn, and speaks the reply with your configured TTS.

Pipeline:

1. Microphone capture (`rec`, 16 kHz mono PCM16) on the gateway host or a paired node.
2. Streaming speech-to-text. Default: ElevenLabs **Scribe v2 Realtime** (`scribe_v2_realtime`) with server-side VAD.
3. Agent turn on the gateway (session key `voice-agent:<target>`, so context carries across turns).
4. Text-to-speech through `messages.tts` and playback (`play`) on the same host.

The mic is muted while the agent speaks, so it does not hear itself. Speech
captured while the agent is thinking is merged into the next turn.

## Requirements

- SoX (`rec`/`play`) on the machine that owns the mic/speaker: `brew install sox` or `apt install sox`.
  Override with `audioInputCommand` / `audioOutputCommand` to use something else.
- An ElevenLabs API key: `ELEVENLABS_API_KEY` (or `XI_API_KEY`), or `stt.providers.elevenlabs.apiKey`.
- A working TTS provider under `messages.tts`.

## Configure

```json5
{
  plugins: {
    entries: {
      "voice-agent": {
        enabled: true,
        config: {
          autoStart: true, // listen as soon as the gateway starts
          // node: "my-node", // use a paired node instead of the gateway host
          // agentId: "main",
          stt: {
            provider: "elevenlabs",
            providers: {
              elevenlabs: {
                // modelId: "scribe_v2_realtime",
                // languageCode: "ko",
                // vadSilenceThresholdSecs: 1.0,
              },
            },
          },
        },
      },
    },
  },
}
```

## Using a node's microphone

Node hosts (`genesis node run`) expose the `voiceagent.audio` command once the
plugin is enabled on the node. Microphone access is opt-in on the gateway:

```json5
{
  gateway: {
    nodes: { allowCommands: ["voiceagent.audio"] },
  },
}
```

Then start a session for that node (by node id or display name):

```bash
genesis voice-agent start --node my-node
```

With `autoStart: true` and `node` set, the gateway retries every 15 seconds until
the node connects.

## CLI

```bash
genesis voice-agent start [--node <id>]   # start listening (gateway host by default)
genesis voice-agent status                # list active sessions and their state
genesis voice-agent stop [--node <id>]    # stop one or all sessions
```

## Control UI

**Chat:** the **Start voice agent** button in the chat composer turns the browser into
the microphone and speaker for the current session. The browser streams audio
straight to ElevenLabs Scribe v2 Realtime with a single-use token minted by the
gateway (`voiceagent.browserSession`); the API key never reaches the browser.
Each finished utterance is sent as a normal chat message, and the agent's reply
is spoken through `talk.speak` (falling back to the browser's built-in speech
synthesis when Talk TTS is not configured). The mic is muted while the reply plays.

**Nodes:** the **Voice agent** card lists gateway and node sessions (state,
turn count, last heard and last replied text) with a Stop button per session.
Use **Listen on gateway** to start on the gateway host, or **Start voice agent**
from a node's action menu. That menu item appears only for nodes that declare
`voiceagent.audio`.

## Gateway methods

| Method                      | Scope            | Purpose                                       |
| --------------------------- | ---------------- | --------------------------------------------- |
| `voiceagent.browserSession` | `operator.write` | Mint a short-lived STT session for a browser  |
| `voiceagent.start`          | `operator.admin` | Start listening on the gateway host or a node |
| `voiceagent.status`         | `operator.read`  | List active gateway/node sessions             |
| `voiceagent.stop`           | `operator.admin` | Stop one or all gateway/node sessions         |

## Audio commands

| Key                  | Default                                                         |
| -------------------- | --------------------------------------------------------------- |
| `audioInputCommand`  | `rec -q -t raw -r 16000 -c 1 -e signed-integer -b 16 -`         |
| `audioOutputCommand` | `play -q -t raw -r {sampleRate} -c 1 -e signed-integer -b 16 -` |

The input command must write 16 kHz mono PCM16 to stdout. The output command
reads PCM16 from stdin; `{sampleRate}` is replaced with the TTS output rate.
