import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { writeBase64ToFile } from "../../cli/nodes-camera.js";
import { canvasSnapshotTempPath, parseCanvasSnapshotPayload } from "../../cli/nodes-canvas.js";
import type { GenesisConfig } from "../../config/types.genesis.js";
import type {
  CanvasDocumentCreateResult,
  CanvasDocumentListResult,
} from "../../gateway/protocol/index.js";
import { logVerbose, shouldLogVerbose } from "../../globals.js";
import { isInboundPathAllowed } from "../../media/inbound-path-policy.js";
import { getDefaultMediaLocalRoots } from "../../media/local-roots.js";
import { imageMimeFromFormat } from "../../media/mime.js";
import { normalizeLowercaseStringOrEmpty } from "../../shared/string-coerce.js";
import { resolveImageSanitizationLimits } from "../image-sanitization.js";
import { optionalStringEnum, stringEnum } from "../schema/typebox.js";
import {
  type AnyAgentTool,
  ToolInputError,
  imageResult,
  jsonResult,
  readNumberParam,
  readStringParam,
  textResult,
} from "./common.js";
import { callGatewayTool, readGatewayCallOptions } from "./gateway.js";
import { resolveNodeId } from "./nodes-utils.js";

const CANVAS_ACTIONS = [
  "create",
  "update",
  "present",
  "hide",
  "navigate",
  "eval",
  "snapshot",
  "a2ui_push",
  "a2ui_reset",
] as const;

const CANVAS_SNAPSHOT_FORMATS = ["png", "jpg", "jpeg"] as const;
const CANVAS_DOCUMENT_KINDS = [
  "html_bundle",
  "url_embed",
  "document",
  "image",
  "video_asset",
  "presentation_asset",
  "model_3d",
  "vector_image",
] as const;
const CANVAS_DOCUMENT_SURFACES = ["assistant_message", "tool_card", "sidebar"] as const;
const CANVAS_DOCUMENT_ASSET_ROLES = ["source", "sidecar", "texture"] as const;

type CanvasDocumentKind = (typeof CANVAS_DOCUMENT_KINDS)[number];
type CanvasDocumentSurface = (typeof CANVAS_DOCUMENT_SURFACES)[number];
type CanvasDocumentAssetParam = {
  logicalPath: string;
  sourcePath: string;
  contentType?: string;
  role?: (typeof CANVAS_DOCUMENT_ASSET_ROLES)[number];
};

async function readJsonlFromPath(jsonlPath: string): Promise<string> {
  const trimmed = jsonlPath.trim();
  if (!trimmed) {
    return "";
  }
  const resolved = path.resolve(trimmed);
  const roots = getDefaultMediaLocalRoots();
  if (!isInboundPathAllowed({ filePath: resolved, roots })) {
    if (shouldLogVerbose()) {
      logVerbose(`Blocked canvas jsonlPath outside allowed roots: ${resolved}`);
    }
    throw new Error("jsonlPath outside allowed roots");
  }
  const canonical = await fs.realpath(resolved).catch(() => resolved);
  if (!isInboundPathAllowed({ filePath: canonical, roots })) {
    if (shouldLogVerbose()) {
      logVerbose(`Blocked canvas jsonlPath outside allowed roots: ${canonical}`);
    }
    throw new Error("jsonlPath outside allowed roots");
  }
  return await fs.readFile(canonical, "utf8");
}

// Flattened schema: runtime validates per-action requirements.
const CanvasToolSchema = Type.Object({
  action: stringEnum(CANVAS_ACTIONS),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  node: Type.Optional(Type.String()),
  // create
  id: Type.Optional(Type.String()),
  kind: optionalStringEnum(CANVAS_DOCUMENT_KINDS),
  title: Type.Optional(Type.String()),
  preferredHeight: Type.Optional(Type.Number()),
  surface: optionalStringEnum(CANVAS_DOCUMENT_SURFACES),
  html: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  workspaceDir: Type.Optional(Type.String()),
  sourceMime: Type.Optional(Type.String()),
  sourceFileName: Type.Optional(Type.String()),
  viewerOptions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  assets: Type.Optional(
    Type.Array(
      Type.Object({
        logicalPath: Type.String(),
        sourcePath: Type.String(),
        contentType: Type.Optional(Type.String()),
        role: optionalStringEnum(CANVAS_DOCUMENT_ASSET_ROLES),
      }),
    ),
  ),
  // present
  target: Type.Optional(Type.String()),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  width: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  // navigate uses `url` above so create/update can share the same field.
  // eval
  javaScript: Type.Optional(Type.String()),
  // snapshot
  outputFormat: optionalStringEnum(CANVAS_SNAPSHOT_FORMATS),
  maxWidth: Type.Optional(Type.Number()),
  quality: Type.Optional(Type.Number()),
  delayMs: Type.Optional(Type.Number()),
  // a2ui_push
  jsonl: Type.Optional(Type.String()),
  jsonlPath: Type.Optional(Type.String()),
});

function readCanvasDocumentKind(params: Record<string, unknown>): CanvasDocumentKind | undefined {
  const value = readStringParam(params, "kind", { trim: true });
  if (!value) {
    return undefined;
  }
  if ((CANVAS_DOCUMENT_KINDS as readonly string[]).includes(value)) {
    return value as CanvasDocumentKind;
  }
  throw new ToolInputError(`kind must be one of ${CANVAS_DOCUMENT_KINDS.join(", ")}`);
}

function readCanvasDocumentSurface(
  params: Record<string, unknown>,
): CanvasDocumentSurface | undefined {
  const value = readStringParam(params, "surface", { trim: true });
  if (!value) {
    return undefined;
  }
  if ((CANVAS_DOCUMENT_SURFACES as readonly string[]).includes(value)) {
    return value as CanvasDocumentSurface;
  }
  throw new ToolInputError(`surface must be one of ${CANVAS_DOCUMENT_SURFACES.join(", ")}`);
}

function readCanvasDocumentAssets(
  params: Record<string, unknown>,
): CanvasDocumentAssetParam[] | undefined {
  if (params.assets === undefined) {
    return undefined;
  }
  if (!Array.isArray(params.assets)) {
    throw new ToolInputError("assets must be an array");
  }
  return params.assets.map((asset, index) => {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      throw new ToolInputError(`assets[${index}] must be an object`);
    }
    const record = asset as Record<string, unknown>;
    const logicalPath = readStringParam(record, "logicalPath", {
      required: true,
      trim: true,
      label: `assets[${index}].logicalPath`,
    });
    const sourcePath = readStringParam(record, "sourcePath", {
      required: true,
      trim: true,
      label: `assets[${index}].sourcePath`,
    });
    const contentType = readStringParam(record, "contentType", {
      trim: true,
      label: `assets[${index}].contentType`,
    });
    const role = readStringParam(record, "role", {
      trim: true,
      label: `assets[${index}].role`,
    });
    if (role && !(CANVAS_DOCUMENT_ASSET_ROLES as readonly string[]).includes(role)) {
      throw new ToolInputError(
        `assets[${index}].role must be one of ${CANVAS_DOCUMENT_ASSET_ROLES.join(", ")}`,
      );
    }
    return {
      logicalPath,
      sourcePath,
      ...(contentType ? { contentType } : {}),
      ...(role ? { role: role as CanvasDocumentAssetParam["role"] } : {}),
    };
  });
}

function escapeEmbedAttribute(value: string): string {
  return value
    .replace(/["\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCanvasEmbedShortcode(manifest: CanvasDocumentCreateResult): string {
  const attrs = [`ref="${escapeEmbedAttribute(manifest.id)}"`];
  if (manifest.title) {
    attrs.push(`title="${escapeEmbedAttribute(manifest.title)}"`);
  }
  if (typeof manifest.preferredHeight === "number" && Number.isFinite(manifest.preferredHeight)) {
    attrs.push(`height="${Math.trunc(manifest.preferredHeight)}"`);
  }
  return `[embed ${attrs.join(" ")} /]`;
}

function buildCanvasPreviewPayload(manifest: CanvasDocumentCreateResult) {
  return {
    kind: "canvas",
    presentation: {
      target: "assistant_message",
      ...(manifest.title ? { title: manifest.title } : {}),
      ...(typeof manifest.preferredHeight === "number" && Number.isFinite(manifest.preferredHeight)
        ? { preferred_height: manifest.preferredHeight }
        : {}),
    },
    view: {
      id: manifest.id,
      url: manifest.entryUrl,
      ...(manifest.title ? { title: manifest.title } : {}),
    },
    document: manifest,
    embed: buildCanvasEmbedShortcode(manifest),
  };
}

async function buildHostedDocumentPreviewPayload(
  gatewayOpts: ReturnType<typeof readGatewayCallOptions>,
  documentId: string,
) {
  const list = await callGatewayTool<CanvasDocumentListResult>(
    "canvas.document.list",
    gatewayOpts,
    {
      limit: 100,
    },
  );
  const manifest = list.documents.find((document) => document.id === documentId);
  if (manifest) {
    return buildCanvasPreviewPayload(manifest);
  }
  throw new ToolInputError(
    `hosted canvas document not found: ${documentId}. Use create with exactly one of html, path, or url first.`,
  );
}

export function createCanvasTool(options?: {
  config?: GenesisConfig;
  workspaceDir?: string;
}): AnyAgentTool {
  const imageSanitization = resolveImageSanitizationLimits(options?.config);
  return {
    label: "Canvas",
    name: "canvas",
    description:
      "Create or update hosted Control UI embeds, or control node canvases. For hosted embeds, create/update require exactly one of html, path, or url; use present with id to return an existing hosted embed preview. Node canvas actions are present/hide/navigate/eval/snapshot/A2UI.",
    parameters: CanvasToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = readGatewayCallOptions(params);

      if (action === "create" || action === "update") {
        const preferredHeight =
          readNumberParam(params, "preferredHeight") ?? readNumberParam(params, "height");
        const id = readStringParam(params, "id", { required: action === "update", trim: true });
        const kind = readCanvasDocumentKind(params);
        const title = readStringParam(params, "title", { trim: true });
        const surface = readCanvasDocumentSurface(params);
        const html = readStringParam(params, "html", { trim: false });
        const filePath = readStringParam(params, "path", { trim: true });
        const url = readStringParam(params, "url", { trim: true });
        const workspaceDir = readStringParam(params, "workspaceDir", { trim: true });
        const entrypointCount = [html, filePath, url].filter((value) => value !== undefined).length;
        if (entrypointCount !== 1) {
          throw new ToolInputError(
            `${action} requires exactly one of html, path, or url. For html_bundle, pass html with the complete markup.`,
          );
        }
        const sourceMime = readStringParam(params, "sourceMime", { trim: true });
        const sourceFileName = readStringParam(params, "sourceFileName", { trim: true });
        const assets = readCanvasDocumentAssets(params);
        const viewerOptions =
          params.viewerOptions &&
          typeof params.viewerOptions === "object" &&
          !Array.isArray(params.viewerOptions)
            ? (params.viewerOptions as Record<string, unknown>)
            : undefined;
        const createParams = {
          ...(id ? { id } : {}),
          ...(kind ? { kind } : {}),
          ...(title ? { title } : {}),
          ...(typeof preferredHeight === "number" && Number.isFinite(preferredHeight)
            ? { preferredHeight }
            : {}),
          ...(surface ? { surface } : {}),
          ...(html ? { html } : {}),
          ...(filePath ? { path: filePath } : {}),
          ...(url ? { url } : {}),
          workspaceDir: workspaceDir ?? options?.workspaceDir ?? process.cwd(),
          ...(sourceMime ? { sourceMime } : {}),
          ...(sourceFileName ? { sourceFileName } : {}),
          ...(viewerOptions ? { viewerOptions } : {}),
          ...(assets ? { assets } : {}),
        };
        const manifest = await callGatewayTool<CanvasDocumentCreateResult>(
          action === "update" ? "canvas.document.update" : "canvas.document.create",
          gatewayOpts,
          createParams,
        );
        const preview = buildCanvasPreviewPayload(manifest);
        return textResult(JSON.stringify(preview, null, 2), preview);
      }

      const hostedDocumentId = readStringParam(params, "id", { trim: true });
      const nodeParam = readStringParam(params, "node", { trim: true });
      if (
        action === "present" &&
        hostedDocumentId &&
        !nodeParam &&
        !readStringParam(params, "target", { trim: true }) &&
        !readStringParam(params, "url", { trim: true }) &&
        !(typeof params.x === "number" && Number.isFinite(params.x)) &&
        !(typeof params.y === "number" && Number.isFinite(params.y)) &&
        !(typeof params.width === "number" && Number.isFinite(params.width)) &&
        !(typeof params.height === "number" && Number.isFinite(params.height))
      ) {
        const preview = await buildHostedDocumentPreviewPayload(gatewayOpts, hostedDocumentId);
        return textResult(JSON.stringify(preview, null, 2), preview);
      }

      if (action === "snapshot" && hostedDocumentId && !nodeParam) {
        throw new ToolInputError(
          "snapshot requires a canvas-capable node. For hosted Control UI documents, reply with the embed shortcode from `present` or `create` instead of snapshotting by id.",
        );
      }

      const nodeId = await resolveNodeId(gatewayOpts, nodeParam, true);

      const invoke = async (command: string, invokeParams?: Record<string, unknown>) =>
        await callGatewayTool("node.invoke", gatewayOpts, {
          nodeId,
          command,
          params: invokeParams,
          idempotencyKey: crypto.randomUUID(),
        });

      switch (action) {
        case "present": {
          const placement = {
            x: typeof params.x === "number" ? params.x : undefined,
            y: typeof params.y === "number" ? params.y : undefined,
            width: typeof params.width === "number" ? params.width : undefined,
            height: typeof params.height === "number" ? params.height : undefined,
          };
          const invokeParams: Record<string, unknown> = {};
          // Accept both `target` and `url` for present to match common caller expectations.
          // `target` remains the canonical field for CLI compatibility.
          const presentTarget =
            readStringParam(params, "target", { trim: true }) ??
            readStringParam(params, "url", { trim: true });
          if (presentTarget) {
            invokeParams.url = presentTarget;
          }
          if (
            Number.isFinite(placement.x) ||
            Number.isFinite(placement.y) ||
            Number.isFinite(placement.width) ||
            Number.isFinite(placement.height)
          ) {
            invokeParams.placement = placement;
          }
          await invoke("canvas.present", invokeParams);
          return jsonResult({ ok: true });
        }
        case "hide":
          await invoke("canvas.hide", undefined);
          return jsonResult({ ok: true });
        case "navigate": {
          // Support `target` as an alias so callers can reuse the same field across present/navigate.
          const url =
            readStringParam(params, "url", { trim: true }) ??
            readStringParam(params, "target", { required: true, trim: true, label: "url" });
          await invoke("canvas.navigate", { url });
          return jsonResult({ ok: true });
        }
        case "eval": {
          const javaScript = readStringParam(params, "javaScript", {
            required: true,
          });
          const raw = (await invoke("canvas.eval", { javaScript })) as {
            payload?: { result?: string };
          };
          const result = raw?.payload?.result;
          if (result) {
            return {
              content: [{ type: "text", text: result }],
              details: { result },
            };
          }
          return jsonResult({ ok: true });
        }
        case "snapshot": {
          const formatRaw = normalizeLowercaseStringOrEmpty(params.outputFormat) || "png";
          const format = formatRaw === "jpg" || formatRaw === "jpeg" ? "jpeg" : "png";
          const maxWidth =
            typeof params.maxWidth === "number" && Number.isFinite(params.maxWidth)
              ? params.maxWidth
              : undefined;
          const quality =
            typeof params.quality === "number" && Number.isFinite(params.quality)
              ? params.quality
              : undefined;
          const raw = (await invoke("canvas.snapshot", {
            format,
            maxWidth,
            quality,
          })) as { payload?: unknown };
          const payload = parseCanvasSnapshotPayload(raw?.payload);
          const filePath = canvasSnapshotTempPath({
            ext: payload.format === "jpeg" ? "jpg" : payload.format,
          });
          await writeBase64ToFile(filePath, payload.base64);
          const mimeType = imageMimeFromFormat(payload.format) ?? "image/png";
          return await imageResult({
            label: "canvas:snapshot",
            path: filePath,
            base64: payload.base64,
            mimeType,
            details: { format: payload.format },
            imageSanitization,
          });
        }
        case "a2ui_push": {
          const jsonl =
            typeof params.jsonl === "string" && params.jsonl.trim()
              ? params.jsonl
              : typeof params.jsonlPath === "string" && params.jsonlPath.trim()
                ? await readJsonlFromPath(params.jsonlPath)
                : "";
          if (!jsonl.trim()) {
            throw new Error("jsonl or jsonlPath required");
          }
          await invoke("canvas.a2ui.pushJSONL", { jsonl });
          return jsonResult({ ok: true });
        }
        case "a2ui_reset":
          await invoke("canvas.a2ui.reset", undefined);
          return jsonResult({ ok: true });
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
