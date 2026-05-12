import { mediaKindFromMime } from "../../../../src/media/constants.js";

export function isRenderableAssistantAttachment(url: string): boolean {
  const trimmed = url.trim();
  return (
    /^https?:\/\//i.test(trimmed) ||
    /^data:(?:image|audio|video)\//i.test(trimmed) ||
    /^\/(?:__genesis__|media)\//.test(trimmed) ||
    trimmed.startsWith("file://") ||
    trimmed.startsWith("~") ||
    trimmed.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  );
}

export function shouldPreserveRelativeAssistantAttachment(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  return (
    !/^https?:\/\//i.test(trimmed) &&
    !/^data:(?:image|audio|video)\//i.test(trimmed) &&
    !/^\/(?:__genesis__|media)\//.test(trimmed) &&
    !trimmed.startsWith("file://") &&
    !trimmed.startsWith("~") &&
    !trimmed.startsWith("/") &&
    !/^[a-zA-Z]:[\\/]/.test(trimmed)
  );
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  opus: "audio/opus",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  caf: "audio/x-caf",
  m4a: "audio/mp4",
  weba: "audio/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  ogv: "video/ogg",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
};

function getFileExtension(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }
  const source = (() => {
    try {
      if (/^https?:\/\//i.test(trimmed)) {
        return new URL(trimmed).pathname;
      }
    } catch {}
    return trimmed;
  })();
  const fileName = source.split(/[\\/]/).pop() ?? source;
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match?.[1]?.toLowerCase();
}

export function mimeTypeFromUrl(url: string): string | undefined {
  const ext = getFileExtension(url);
  return ext ? MIME_BY_EXT[ext] : undefined;
}

export function inferAttachmentKind(url: string): {
  kind: "image" | "audio" | "video" | "document";
  mimeType?: string;
  label: string;
} {
  const mimeType = mimeTypeFromUrl(url);
  const kind = mediaKindFromMime(mimeType) ?? "document";
  const label = (() => {
    try {
      if (/^https?:\/\//i.test(url)) {
        const parsed = new URL(url);
        const name = parsed.pathname.split("/").pop()?.trim();
        return name || parsed.hostname || url;
      }
    } catch {}
    const name = url.split(/[\\/]/).pop()?.trim();
    return name || url;
  })();
  return { kind, mimeType, label };
}
