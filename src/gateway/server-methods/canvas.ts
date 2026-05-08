import { loadConfig } from "../../config/config.js";
import type {
  CanvasDocumentAsset,
  CanvasDocumentCreateInput,
  CanvasDocumentEntrypoint,
  CanvasDocumentKind,
} from "../canvas-documents.js";
import {
  createCanvasDocument,
  inferCanvasDocumentKindFromSource,
  listCanvasDocumentManifests,
  updateCanvasDocument,
} from "../canvas-documents.js";
import {
  ErrorCodes,
  errorShape,
  validateCanvasDocumentCreateParams,
  validateCanvasDocumentListParams,
  validateCanvasDocumentUpdateParams,
  type CanvasDocumentCreateParams,
  type CanvasDocumentListParams,
  type CanvasDocumentUpdateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

type CanvasDocumentSurface = NonNullable<CanvasDocumentCreateInput["surface"]>;
type CanvasDocumentAssetRole = NonNullable<CanvasDocumentAsset["role"]>;

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function resolveEntrypoint(
  method: "canvas.document.create" | "canvas.document.update",
  params: CanvasDocumentCreateParams | CanvasDocumentUpdateParams,
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
        `${method} requires exactly one of html, path, or url`,
      ),
    );
    return null;
  }
  return candidates[0];
}

function inferDocumentKind(
  params: CanvasDocumentCreateParams | CanvasDocumentUpdateParams,
  entrypoint: CanvasDocumentEntrypoint,
): CanvasDocumentKind {
  if (params.kind) {
    return params.kind as CanvasDocumentKind;
  }
  return inferCanvasDocumentKindFromSource(entrypoint.value, entrypoint.type);
}

function normalizeAssetRole(value: unknown): CanvasDocumentAssetRole | undefined {
  return value === "source" || value === "sidecar" || value === "texture" ? value : undefined;
}

function buildCanvasDocumentAssets(
  assets: (CanvasDocumentCreateParams | CanvasDocumentUpdateParams)["assets"],
): CanvasDocumentAsset[] | undefined {
  return assets?.map((asset) => {
    const role = normalizeAssetRole(asset.role);
    return {
      logicalPath: asset.logicalPath,
      sourcePath: asset.sourcePath,
      ...(asset.contentType ? { contentType: asset.contentType } : {}),
      ...(role ? { role } : {}),
    };
  });
}

function buildCreateInput(
  params: CanvasDocumentCreateParams | CanvasDocumentUpdateParams,
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
    ...(params.assets ? { assets: buildCanvasDocumentAssets(params.assets) } : {}),
    ...(params.sourceMime ? { sourceMime: params.sourceMime } : {}),
    ...(params.sourceFileName ? { sourceFileName: params.sourceFileName } : {}),
    ...(params.viewerOptions ? { viewerOptions: params.viewerOptions } : {}),
  };
}

function rejectDisabledCanvasHost(
  config: ReturnType<typeof loadConfig>,
  respond: RespondFn,
): boolean {
  if (process.env.GENESIS_SKIP_CANVAS_HOST === "1" || config.canvasHost?.enabled === false) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "canvas host is disabled"));
    return true;
  }
  return false;
}

export const canvasHandlers: GatewayRequestHandlers = {
  "canvas.document.list": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params ?? {},
        validateCanvasDocumentListParams,
        "canvas.document.list",
        respond,
      )
    ) {
      return;
    }
    const config = loadConfig();
    if (rejectDisabledCanvasHost(config, respond)) {
      return;
    }
    try {
      const listParams = (params ?? {}) as CanvasDocumentListParams;
      const documents = await listCanvasDocumentManifests({
        canvasRootDir: config.canvasHost?.root,
        limit: listParams.limit,
      });
      respond(true, { documents }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
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
    if (rejectDisabledCanvasHost(config, respond)) {
      return;
    }
    const entrypoint = resolveEntrypoint("canvas.document.create", params, respond);
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
  "canvas.document.update": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateCanvasDocumentUpdateParams,
        "canvas.document.update",
        respond,
      )
    ) {
      return;
    }
    const config = loadConfig();
    if (rejectDisabledCanvasHost(config, respond)) {
      return;
    }
    const entrypoint = resolveEntrypoint("canvas.document.update", params, respond);
    if (!entrypoint) {
      return;
    }

    try {
      const manifest = await updateCanvasDocument(
        buildCreateInput(params, entrypoint) as CanvasDocumentCreateInput & { id: string },
        {
          canvasRootDir: config.canvasHost?.root,
          workspaceDir: params.workspaceDir,
        },
      );
      respond(true, manifest, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
