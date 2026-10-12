import { describe, expect, it, vi } from "vitest";
import type { GenesisConfig } from "../../src/config/types.genesis.js";

const fetchWithSsrFGuardMock = vi.hoisted(() => vi.fn());

vi.mock("genesis/plugin-sdk/ssrf-runtime", () => ({
  fetchWithSsrFGuard: fetchWithSsrFGuardMock,
  ssrfPolicyFromHttpBaseUrlAllowedHostname: () => ({}),
}));

import {
  __testing,
  buildElevenLabsRealtimeTranscriptionProvider,
} from "./realtime-transcription-provider.js";

describe("buildElevenLabsRealtimeTranscriptionProvider", () => {
  it("normalizes nested provider config", () => {
    const provider = buildElevenLabsRealtimeTranscriptionProvider();
    const resolved = provider.resolveConfig?.({
      cfg: {} as GenesisConfig,
      rawConfig: {
        providers: {
          elevenlabs: {
            apiKey: "eleven-key",
            model_id: "scribe_v2_realtime",
            audio_format: "ulaw_8000",
            sample_rate: "8000",
            commit_strategy: "vad",
            language: "en",
          },
        },
      },
    });

    expect(resolved).toMatchObject({
      apiKey: "eleven-key",
      audioFormat: "ulaw_8000",
      sampleRate: 8000,
      commitStrategy: "vad",
      languageCode: "en",
    });
  });

  it("builds an ElevenLabs realtime websocket URL", () => {
    const url = __testing.toElevenLabsRealtimeWsUrl({
      apiKey: "eleven-key",
      baseUrl: "https://api.elevenlabs.io",
      modelId: "scribe_v2_realtime",
      audioFormat: "ulaw_8000",
      sampleRate: 8000,
      commitStrategy: "vad",
      languageCode: "en",
    });

    expect(url).toContain("wss://api.elevenlabs.io/v1/speech-to-text/realtime?");
    expect(url).toContain("model_id=scribe_v2_realtime");
    expect(url).toContain("audio_format=ulaw_8000");
    expect(url).toContain("commit_strategy=vad");
    expect(url).toContain("language_code=en");
  });

  it("mints a single-use token for browser sessions and forces 16 kHz PCM with VAD", async () => {
    fetchWithSsrFGuardMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ token: "sutkn_abc" }), { status: 200 }),
      release: async () => {},
    });
    const provider = buildElevenLabsRealtimeTranscriptionProvider();

    const session = await provider.createBrowserSession?.({
      providerConfig: { apiKey: "eleven-key", audioFormat: "ulaw_8000", languageCode: "ko" },
    });

    expect(fetchWithSsrFGuardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
        init: { method: "POST", headers: { "xi-api-key": "eleven-key" } },
      }),
    );
    expect(session).toMatchObject({
      provider: "elevenlabs",
      protocol: "elevenlabs-scribe-realtime",
      sampleRate: 16_000,
    });
    const url = new URL(session?.url ?? "");
    expect(url.searchParams.get("token")).toBe("sutkn_abc");
    expect(url.searchParams.get("audio_format")).toBe("pcm_16000");
    expect(url.searchParams.get("commit_strategy")).toBe("vad");
    expect(url.searchParams.get("language_code")).toBe("ko");
    expect(url.toString()).not.toContain("eleven-key");
  });
});
