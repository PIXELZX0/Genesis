import { transcribeFirstAudio as transcribeFirstAudioImpl } from "genesis/plugin-sdk/media-runtime";

type TranscribeFirstAudio = typeof import("genesis/plugin-sdk/media-runtime").transcribeFirstAudio;

export async function transcribeFirstAudio(
  ...args: Parameters<TranscribeFirstAudio>
): ReturnType<TranscribeFirstAudio> {
  return await transcribeFirstAudioImpl(...args);
}
