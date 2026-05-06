import { loadConfig } from "../../config/config.js";
import type {
  CanvasDocumentCreateInput,
  CanvasDocumentEntrypoint,
  CanvasDocumentKind,
} from "../canvas-documents.js";
import { createCanvasDocument } from "../canvas-documents.js";
import {
  ErrorCodes,
  errorShape,
  validateCanvasDocumentCreateParams,
  type CanvasDocumentCreateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

type CanvasDocumentSurface = NonNullable<CanvasDocumentCreateInput["surface"]>;

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function resolveEntrypoint(
  params: CanvasDocumentCreateParams,
  respond: RespondFn,
): CanvasDocumentEntrypoint | null {
  const candidates = [
    { type: "html" as const, value: normalizeString(params.html) },
    { type: "path" as const, value: normalizeString(params.path) },
    { type: "url" as const, value: normalizeString(params.url) },
  ].filter((candidate): candidate is CanvasDocumentEntrypoint => Boolean(candidate.value));

  if (candidates.length !== 1) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "canvas.document.create requires exactly one of html, path, or url",
      ),
    );
    return null;
  }
  return candidates[0];
}

function inferDocumentKind(
  params: CanvasDocumentCreateParams,
  entrypoint: CanvasDocumentEntrypoint,
): CanvasDocumentKind {
  if (params.kind) {
    return params.kind as CanvasDocumentKind;
  }
  if (entrypoint.type === "html") {
    return "html_bundle";
  }
  if (entrypoint.type === "url") {
    return /\.pdf(?:[?#].*)?$/i.test(entrypoint.value.trim()) ? "document" : "url_embed";
  }
  if (/\.(?:png|jpe?g|webp|gif|heic|heif)(?:[?#].*)?$/i.test(entrypoint.value.trim())) {
    return "image";
  }
  if (/\.(?:mp4|mov|webm|m4v)(?:[?#].*)?$/i.test(entrypoint.value.trim())) {
    return "video_asset";
  }
  return /\.pdf(?:[?#].*)?$/i.test(entrypoint.value.trim()) ? "document" : "html_bundle";
}

function buildCreateInput(
  params: CanvasDocumentCreateParams,
  entrypoint: CanvasDocumentEntrypoint,
): CanvasDocumentCreateInput {
  return {
    ...(params.id ? { id: params.id } : {}),
    kind: inferDocumentKind(params, entrypoint),
    ...(params.title ? { title: params.title } : {}),
    ...(typeof params.preferredHeight === "number" && Number.isFinite(params.preferredHeight)
      ? { preferredHeight: params.preferredHeight }
      : {}),
    surface: (params.surface as CanvasDocumentSurface | undefined) ?? "assistant_message",
    entrypoint,
    ...(params.assets ? { assets: params.assets } : {}),
  };
}

export const canvasHandlers: GatewayRequestHandlers = {
  "canvas.document.create": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateCanvasDocumentCreateParams,
        "canvas.document.create",
        respond,
      )
    ) {
      return;
    }
    const config = loadConfig();
    if (process.env.GENESIS_SKIP_CANVAS_HOST === "1" || config.canvasHost?.enabled === false) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "canvas host is disabled"));
      return;
    }
    const entrypoint = resolveEntrypoint(params, respond);
    if (!entrypoint) {
      return;
    }

    try {
      const manifest = await createCanvasDocument(buildCreateInput(params, entrypoint), {
        canvasRootDir: config.canvasHost?.root,
        workspaceDir: params.workspaceDir,
      });
      respond(true, manifest, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
