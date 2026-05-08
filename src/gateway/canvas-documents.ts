import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { CANVAS_HOST_PATH } from "../canvas-host/a2ui.js";
import { resolveStateDir } from "../config/paths.js";
import { detectMime, mimeTypeFromFilePath } from "../media/mime.js";
import { resolveUserPath } from "../utils.js";
import {
  buildImageWrapperHtml,
  buildModelViewerHtml,
  buildPdfWrapperHtml,
  buildPresentationFallbackHtml,
  buildPptxViewerHtml,
  buildSvgViewerHtml,
  buildVideoWrapperHtml,
  type CanvasViewerName,
} from "./canvas-viewers.js";

const execFileAsync = promisify(execFile);

export type CanvasDocumentKind =
  | "html_bundle"
  | "url_embed"
  | "document"
  | "image"
  | "video_asset"
  | "presentation_asset"
  | "model_3d"
  | "vector_image";

export type CanvasDocumentAsset = {
  logicalPath: string;
  sourcePath: string;
  contentType?: string;
  role?: "source" | "sidecar" | "texture";
};

export type CanvasDocumentEntrypoint =
  | { type: "html"; value: string }
  | { type: "path"; value: string }
  | { type: "url"; value: string };

export type CanvasDocumentCreateInput = {
  id?: string;
  kind: CanvasDocumentKind;
  title?: string;
  preferredHeight?: number;
  entrypoint?: CanvasDocumentEntrypoint;
  assets?: CanvasDocumentAsset[];
  surface?: "assistant_message" | "tool_card" | "sidebar";
  sourceMime?: string;
  sourceFileName?: string;
  viewerOptions?: Record<string, unknown>;
};

export type CanvasDocumentManifest = {
  id: string;
  kind: CanvasDocumentKind;
  title?: string;
  preferredHeight?: number;
  createdAt: string;
  updatedAt?: string;
  revision: number;
  entryUrl: string;
  localEntrypoint?: string;
  externalUrl?: string;
  sourceMime?: string;
  sourceFileName?: string;
  viewer?: CanvasViewerName;
  viewerOptions?: Record<string, unknown>;
  surface?: "assistant_message" | "tool_card" | "sidebar";
  assets: Array<{
    logicalPath: string;
    contentType?: string;
    sourceFileName?: string;
    sizeBytes?: number;
    role?: "source" | "sidecar" | "texture";
  }>;
};

export type CanvasDocumentResolvedAsset = {
  logicalPath: string;
  contentType?: string;
  url: string;
  localPath: string;
};

const CANVAS_DOCUMENTS_DIR_NAME = "documents";
const CANVAS_REVISIONS_DIR_NAME = "revisions";

const PPT_MIME = "application/vnd.ms-powerpoint";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SVG_MIME = "image/svg+xml";

type CopiedAssetRole = NonNullable<CanvasDocumentManifest["assets"][number]["role"]>;

type MaterializedEntrypoint = Pick<
  CanvasDocumentManifest,
  | "entryUrl"
  | "localEntrypoint"
  | "externalUrl"
  | "sourceMime"
  | "sourceFileName"
  | "viewer"
  | "viewerOptions"
> & {
  copiedAssets: CanvasDocumentManifest["assets"];
};

function extensionFromPathLike(value: string): string {
  const clean = (() => {
    try {
      if (/^https?:\/\//i.test(value)) {
        return new URL(value).pathname;
      }
    } catch {
      // fall back to plain path parsing
    }
    return value.replace(/[?#].*$/, "");
  })();
  return path.extname(clean).toLowerCase();
}

function fileNameFromPathLike(value: string): string | undefined {
  try {
    if (/^https?:\/\//i.test(value)) {
      const name = new URL(value).pathname.split("/").pop()?.trim();
      return name ? decodeURIComponent(name) : undefined;
    }
  } catch {
    // fall back to plain path parsing
  }
  const name = value
    .replace(/[?#].*$/, "")
    .split(/[\\/]/)
    .pop()
    ?.trim();
  return name || undefined;
}

function isPdfPathLike(value: string): boolean {
  return extensionFromPathLike(value) === ".pdf";
}

function isPptPathLike(value: string): boolean {
  return extensionFromPathLike(value) === ".ppt";
}

function isPptxPathLike(value: string): boolean {
  return extensionFromPathLike(value) === ".pptx";
}

function isSvgPathLike(value: string): boolean {
  return extensionFromPathLike(value) === ".svg";
}

function isModelPathLike(value: string): boolean {
  return [".glb", ".gltf", ".obj", ".stl"].includes(extensionFromPathLike(value));
}

function isVideoPathLike(value: string): boolean {
  return [".mp4", ".mov", ".webm", ".m4v"].includes(extensionFromPathLike(value));
}

function isImagePathLike(value: string): boolean {
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif"].includes(
    extensionFromPathLike(value),
  );
}

function modelFormatFromFileName(value: string): "gltf" | "glb" | "obj" | "stl" | undefined {
  const ext = extensionFromPathLike(value);
  if (ext === ".gltf" || ext === ".glb" || ext === ".obj" || ext === ".stl") {
    return ext.slice(1) as "gltf" | "glb" | "obj" | "stl";
  }
  return undefined;
}

export function inferCanvasDocumentKindFromSource(
  value: string,
  entrypointType: CanvasDocumentEntrypoint["type"],
): CanvasDocumentKind {
  if (entrypointType === "html") {
    return "html_bundle";
  }
  if (isPptPathLike(value) || isPptxPathLike(value)) {
    return "presentation_asset";
  }
  if (isSvgPathLike(value)) {
    return "vector_image";
  }
  if (isModelPathLike(value)) {
    return "model_3d";
  }
  if (isImagePathLike(value)) {
    return "image";
  }
  if (isVideoPathLike(value)) {
    return "video_asset";
  }
  if (isPdfPathLike(value)) {
    return "document";
  }
  return entrypointType === "url" ? "url_embed" : "html_bundle";
}

function encodeAssetHref(logicalPath: string): string {
  return normalizeLogicalPath(logicalPath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeLogicalPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("canvas document logicalPath invalid");
  }
  return parts.join("/");
}

function canvasDocumentId(): string {
  return `cv_${randomUUID().replaceAll("-", "")}`;
}

function normalizeCanvasDocumentId(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    !/^[A-Za-z0-9._-]+$/.test(normalized)
  ) {
    throw new Error("canvas document id invalid");
  }
  return normalized;
}

export function resolveCanvasRootDir(rootDir?: string, stateDir = resolveStateDir()): string {
  const resolved = rootDir?.trim() ? resolveUserPath(rootDir) : path.join(stateDir, "canvas");
  return path.resolve(resolved);
}

export function resolveCanvasDocumentsDir(rootDir?: string, stateDir = resolveStateDir()): string {
  return path.join(resolveCanvasRootDir(rootDir, stateDir), CANVAS_DOCUMENTS_DIR_NAME);
}

export function resolveCanvasDocumentDir(
  documentId: string,
  options?: { rootDir?: string; stateDir?: string },
): string {
  return path.join(resolveCanvasDocumentsDir(options?.rootDir, options?.stateDir), documentId);
}

export function buildCanvasDocumentEntryUrl(documentId: string, entrypoint: string): string {
  const normalizedEntrypoint = normalizeLogicalPath(entrypoint);
  const encodedEntrypoint = normalizedEntrypoint
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${CANVAS_HOST_PATH}/${CANVAS_DOCUMENTS_DIR_NAME}/${encodeURIComponent(documentId)}/${encodedEntrypoint}`;
}

export function buildCanvasDocumentAssetUrl(documentId: string, logicalPath: string): string {
  return buildCanvasDocumentEntryUrl(documentId, logicalPath);
}

export function resolveCanvasHttpPathToLocalPath(
  requestPath: string,
  options?: { rootDir?: string; stateDir?: string },
): string | null {
  const trimmed = requestPath.trim();
  const prefix = `${CANVAS_HOST_PATH}/${CANVAS_DOCUMENTS_DIR_NAME}/`;
  if (!trimmed.startsWith(prefix)) {
    return null;
  }
  const pathWithoutQuery = trimmed.replace(/[?#].*$/, "");
  const relative = pathWithoutQuery.slice(prefix.length);
  const segments = relative
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  const [rawDocumentId, ...entrySegments] = segments;
  try {
    const documentId = normalizeCanvasDocumentId(rawDocumentId);
    const normalizedEntrypoint = normalizeLogicalPath(entrySegments.join("/"));
    const documentsDir = path.resolve(
      resolveCanvasDocumentsDir(options?.rootDir, options?.stateDir),
    );
    const candidatePath = path.resolve(
      resolveCanvasDocumentDir(documentId, options),
      normalizedEntrypoint,
    );
    if (
      !(candidatePath === documentsDir || candidatePath.startsWith(`${documentsDir}${path.sep}`))
    ) {
      return null;
    }
    return candidatePath;
  } catch {
    return null;
  }
}

async function writeManifest(rootDir: string, manifest: CanvasDocumentManifest): Promise<void> {
  await fs.writeFile(
    path.join(rootDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

export function resolveCanvasDocumentRevisionDir(
  documentId: string,
  revision: number,
  options?: { rootDir?: string; stateDir?: string },
): string {
  return path.join(
    resolveCanvasDocumentDir(documentId, options),
    CANVAS_REVISIONS_DIR_NAME,
    String(revision),
  );
}

function assertPathInside(parent: string, candidate: string, message: string): void {
  const parentResolved = path.resolve(parent);
  const candidateResolved = path.resolve(candidate);
  if (
    candidateResolved !== parentResolved &&
    !candidateResolved.startsWith(`${parentResolved}${path.sep}`)
  ) {
    throw new Error(message);
  }
}

async function resolveWorkspaceRoot(workspaceDir: string): Promise<string> {
  const resolved = workspaceDir.startsWith("~")
    ? resolveUserPath(workspaceDir)
    : path.resolve(workspaceDir);
  return await fs.realpath(resolved);
}

async function resolveAssetSourcePath(
  sourcePath: string,
  workspaceDir: string,
): Promise<{ realPath: string; sourceFileName: string }> {
  const workspaceRoot = await resolveWorkspaceRoot(workspaceDir);
  const candidate = sourcePath.startsWith("~")
    ? resolveUserPath(sourcePath)
    : path.isAbsolute(sourcePath)
      ? path.resolve(sourcePath)
      : path.resolve(workspaceRoot, sourcePath);
  const realPath = await fs.realpath(candidate);
  assertPathInside(workspaceRoot, realPath, "canvas document sourcePath escapes workspace");
  return {
    realPath,
    sourceFileName: path.basename(candidate) || path.basename(realPath),
  };
}

async function copyResolvedAsset(params: {
  rootDir: string;
  sourcePath: string;
  logicalPath: string;
  workspaceDir: string;
  contentType?: string;
  role?: CopiedAssetRole;
  seen: Set<string>;
}): Promise<CanvasDocumentManifest["assets"][number] | null> {
  const logicalPath = normalizeLogicalPath(params.logicalPath);
  if (params.seen.has(logicalPath)) {
    return null;
  }
  const source = await resolveAssetSourcePath(params.sourcePath, params.workspaceDir);
  const rootResolved = path.resolve(params.rootDir);
  const destination = path.resolve(rootResolved, logicalPath);
  assertPathInside(rootResolved, destination, "canvas document destination escapes document root");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source.realPath, destination);
  const stat = await fs.stat(source.realPath);
  const contentType = params.contentType ?? (await detectMime({ filePath: source.realPath }));
  params.seen.add(logicalPath);
  return {
    logicalPath,
    ...(contentType ? { contentType } : {}),
    sourceFileName: source.sourceFileName,
    sizeBytes: stat.size,
    ...(params.role ? { role: params.role } : {}),
  };
}

async function copyAssets(
  rootDir: string,
  assets: CanvasDocumentAsset[] | undefined,
  workspaceDir: string,
  seen: Set<string>,
): Promise<CanvasDocumentManifest["assets"]> {
  const copied: CanvasDocumentManifest["assets"] = [];
  for (const asset of assets ?? []) {
    const copiedAsset = await copyResolvedAsset({
      rootDir,
      sourcePath: asset.sourcePath,
      logicalPath: asset.logicalPath,
      workspaceDir,
      contentType: asset.contentType,
      role: asset.role,
      seen,
    });
    if (copiedAsset) {
      copied.push(copiedAsset);
    }
  }
  return copied;
}

async function copyMainSource(params: {
  rootDir: string;
  sourcePath: string;
  workspaceDir: string;
  contentType?: string;
  seen: Set<string>;
}): Promise<{
  copied: CanvasDocumentManifest["assets"][number];
  logicalPath: string;
  localPath: string;
  originalPath: string;
  sourceFileName: string;
  sourceMime?: string;
}> {
  const source = await resolveAssetSourcePath(params.sourcePath, params.workspaceDir);
  const logicalPath = normalizeLogicalPath(path.basename(source.sourceFileName || source.realPath));
  const copied = await copyResolvedAsset({
    rootDir: params.rootDir,
    sourcePath: source.realPath,
    logicalPath,
    workspaceDir: params.workspaceDir,
    contentType: params.contentType,
    role: "source",
    seen: params.seen,
  });
  if (!copied) {
    throw new Error("canvas document source asset duplicated");
  }
  return {
    copied,
    logicalPath,
    localPath: path.join(params.rootDir, logicalPath),
    originalPath: source.realPath,
    sourceFileName: copied.sourceFileName ?? path.basename(source.realPath),
    ...(copied.contentType ? { sourceMime: copied.contentType } : {}),
  };
}

function safeSidecarLogicalPath(raw: string): string | null {
  const cleaned = raw.trim().replace(/[?#].*$/, "");
  if (
    !cleaned ||
    /^data:/i.test(cleaned) ||
    /^https?:\/\//i.test(cleaned) ||
    path.isAbsolute(cleaned)
  ) {
    return null;
  }
  try {
    return normalizeLogicalPath(decodeURIComponent(cleaned));
  } catch {
    return null;
  }
}

function collectMtlTexturePaths(mtl: string): string[] {
  const textureKeys = new Set(["map_kd", "map_ks", "map_ke", "map_bump", "bump", "norm", "map_d"]);
  const found: string[] = [];
  for (const line of mtl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const [keyRaw, ...rest] = trimmed.split(/\s+/);
    const key = keyRaw?.toLowerCase();
    if (!key || !textureKeys.has(key) || rest.length === 0) {
      continue;
    }
    const candidate = rest[rest.length - 1];
    if (candidate) {
      found.push(candidate);
    }
  }
  return found;
}

async function discoverModelSidecars(
  sourcePath: string,
): Promise<Array<{ logicalPath: string; sourcePath: string; role: CopiedAssetRole }>> {
  const sourceDir = path.dirname(sourcePath);
  const ext = extensionFromPathLike(sourcePath);
  const sidecars: Array<{ logicalPath: string; sourcePath: string; role: CopiedAssetRole }> = [];
  const pushSidecar = (raw: string, role: CopiedAssetRole) => {
    const logicalPath = safeSidecarLogicalPath(raw);
    if (!logicalPath) {
      return;
    }
    sidecars.push({
      logicalPath,
      sourcePath: path.resolve(sourceDir, logicalPath),
      role,
    });
  };

  if (ext === ".gltf") {
    try {
      const parsed = JSON.parse(await fs.readFile(sourcePath, "utf8")) as {
        buffers?: Array<{ uri?: unknown }>;
        images?: Array<{ uri?: unknown }>;
      };
      for (const item of parsed.buffers ?? []) {
        if (typeof item.uri === "string") {
          pushSidecar(item.uri, "sidecar");
        }
      }
      for (const item of parsed.images ?? []) {
        if (typeof item.uri === "string") {
          pushSidecar(item.uri, "texture");
        }
      }
    } catch {
      // The viewer will surface parse errors. Sidecar discovery is best effort.
    }
  }

  if (ext === ".obj") {
    try {
      const raw = await fs.readFile(sourcePath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const match = /^\s*mtllib\s+(.+?)\s*$/.exec(line);
        if (!match?.[1]) {
          continue;
        }
        const logicalPath = safeSidecarLogicalPath(match[1]);
        if (!logicalPath) {
          continue;
        }
        const mtlPath = path.resolve(sourceDir, logicalPath);
        sidecars.push({ logicalPath, sourcePath: mtlPath, role: "sidecar" });
        try {
          const mtl = await fs.readFile(mtlPath, "utf8");
          for (const texturePath of collectMtlTexturePaths(mtl)) {
            const textureLogical = safeSidecarLogicalPath(
              path.posix.join(path.posix.dirname(logicalPath), texturePath),
            );
            if (textureLogical) {
              sidecars.push({
                logicalPath: textureLogical,
                sourcePath: path.resolve(path.dirname(mtlPath), texturePath),
                role: "texture",
              });
            }
          }
        } catch {
          // Missing MTL files should not block OBJ preview.
        }
      }
    } catch {
      // The viewer will surface loader errors.
    }
  }

  return sidecars;
}

async function readPptxMetadata(
  filePath: string,
): Promise<{ slideCount?: number; validationError?: string }> {
  try {
    const zip = await JSZip.loadAsync(await fs.readFile(filePath));
    if (!zip.file("[Content_Types].xml") || !zip.file("ppt/presentation.xml")) {
      return { validationError: "This PPTX file is missing required PresentationML parts." };
    }
    const slideCount = Object.keys(zip.files).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(name),
    ).length;
    return { slideCount };
  } catch (err) {
    return {
      validationError: `Unable to read PPTX package: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function findPresentationConverter(): Promise<string | null> {
  for (const command of ["soffice", "libreoffice"]) {
    try {
      await execFileAsync(command, ["--version"], { timeout: 5_000 });
      return command;
    } catch {
      // Try the next known LibreOffice binary name.
    }
  }
  return null;
}

async function convertPptToPptx(
  sourcePath: string,
  outputDir: string,
): Promise<{ logicalPath: string; localPath: string; converter: string } | null> {
  const converter = await findPresentationConverter();
  if (!converter) {
    return null;
  }
  try {
    await execFileAsync(
      converter,
      ["--headless", "--convert-to", "pptx", "--outdir", outputDir, sourcePath],
      {
        timeout: 60_000,
      },
    );
    const logicalPath = normalizeLogicalPath(path.basename(sourcePath).replace(/\.ppt$/i, ".pptx"));
    const localPath = path.join(outputDir, logicalPath);
    await fs.stat(localPath);
    return { logicalPath, localPath, converter };
  } catch {
    return null;
  }
}

async function materializeEntrypoint(
  rootDir: string,
  input: CanvasDocumentCreateInput,
  workspaceDir: string,
  documentId: string,
  seen: Set<string>,
): Promise<MaterializedEntrypoint> {
  const entrypoint = input.entrypoint;
  if (!entrypoint) {
    throw new Error("canvas document entrypoint required");
  }
  if (entrypoint.type === "html") {
    const fileName = "index.html";
    await fs.writeFile(path.join(rootDir, fileName), entrypoint.value, "utf8");
    return {
      localEntrypoint: fileName,
      entryUrl: buildCanvasDocumentEntryUrl(documentId, fileName),
      sourceMime: input.sourceMime ?? "text/html",
      sourceFileName: input.sourceFileName,
      viewer: "html",
      ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
      copiedAssets: [],
    };
  }
  if (entrypoint.type === "url") {
    const sourceMime = input.sourceMime ?? mimeTypeFromFilePath(entrypoint.value);
    const sourceFileName = input.sourceFileName ?? fileNameFromPathLike(entrypoint.value);
    if (input.kind === "document" && isPdfPathLike(entrypoint.value)) {
      const fileName = "index.html";
      await fs.writeFile(
        path.join(rootDir, fileName),
        buildPdfWrapperHtml(entrypoint.value),
        "utf8",
      );
      return {
        localEntrypoint: fileName,
        externalUrl: entrypoint.value,
        entryUrl: buildCanvasDocumentEntryUrl(documentId, fileName),
        sourceMime: sourceMime ?? "application/pdf",
        sourceFileName,
        viewer: "pdf",
        ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
        copiedAssets: [],
      };
    }
    if (input.kind === "presentation_asset") {
      const fileName = "index.html";
      const title = input.title ?? sourceFileName ?? "Presentation";
      const html = isPptxPathLike(entrypoint.value)
        ? buildPptxViewerHtml({
            sourceHref: entrypoint.value,
            sourceFileName: sourceFileName ?? "presentation.pptx",
            title,
          })
        : buildPresentationFallbackHtml({
            sourceHref: entrypoint.value,
            sourceFileName: sourceFileName ?? "presentation.ppt",
            title,
            reason:
              "Legacy PPT preview requires optional local conversion before Genesis can render it in the browser.",
          });
      await fs.writeFile(path.join(rootDir, fileName), html, "utf8");
      return {
        localEntrypoint: fileName,
        externalUrl: entrypoint.value,
        entryUrl: buildCanvasDocumentEntryUrl(documentId, fileName),
        sourceMime: sourceMime ?? (isPptPathLike(entrypoint.value) ? PPT_MIME : PPTX_MIME),
        sourceFileName,
        viewer: isPptxPathLike(entrypoint.value) ? "pptx" : "ppt_fallback",
        ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
        copiedAssets: [],
      };
    }
    if (input.kind === "vector_image") {
      const fileName = "index.html";
      await fs.writeFile(
        path.join(rootDir, fileName),
        buildSvgViewerHtml({
          sourceHref: entrypoint.value,
          sourceFileName: sourceFileName ?? "image.svg",
          title: input.title,
        }),
        "utf8",
      );
      return {
        localEntrypoint: fileName,
        externalUrl: entrypoint.value,
        entryUrl: buildCanvasDocumentEntryUrl(documentId, fileName),
        sourceMime: sourceMime ?? SVG_MIME,
        sourceFileName,
        viewer: "svg",
        ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
        copiedAssets: [],
      };
    }
    if (input.kind === "model_3d") {
      const format = modelFormatFromFileName(entrypoint.value);
      const fileName = "index.html";
      if (format) {
        await fs.writeFile(
          path.join(rootDir, fileName),
          buildModelViewerHtml({
            sourceHref: entrypoint.value,
            sourceFileName: sourceFileName ?? `model.${format}`,
            title: input.title,
            format,
          }),
          "utf8",
        );
        return {
          localEntrypoint: fileName,
          externalUrl: entrypoint.value,
          entryUrl: buildCanvasDocumentEntryUrl(documentId, fileName),
          sourceMime,
          sourceFileName,
          viewer: "threejs",
          ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
          copiedAssets: [],
        };
      }
    }
    return {
      externalUrl: entrypoint.value,
      entryUrl: entrypoint.value,
      sourceMime,
      sourceFileName,
      viewer: "url",
      ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
      copiedAssets: [],
    };
  }

  const sourceMime = input.sourceMime ?? (await detectMime({ filePath: entrypoint.value }));
  const source = await copyMainSource({
    rootDir,
    sourcePath: entrypoint.value,
    workspaceDir,
    contentType: sourceMime,
    seen,
  });
  const sourceHref = encodeAssetHref(source.logicalPath);
  const sourceFileName = input.sourceFileName ?? source.sourceFileName;
  const sourceMimeResolved = input.sourceMime ?? source.sourceMime;

  if (input.kind === "image") {
    await fs.writeFile(
      path.join(rootDir, "index.html"),
      buildImageWrapperHtml({
        sourceHref,
        sourceFileName,
        title: input.title,
      }),
      "utf8",
    );
    return {
      localEntrypoint: "index.html",
      entryUrl: buildCanvasDocumentEntryUrl(documentId, "index.html"),
      sourceMime: sourceMimeResolved,
      sourceFileName,
      viewer: "image",
      ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
      copiedAssets: [source.copied],
    };
  }

  if (input.kind === "video_asset") {
    await fs.writeFile(
      path.join(rootDir, "index.html"),
      buildVideoWrapperHtml({
        sourceHref,
        sourceFileName,
        title: input.title,
      }),
      "utf8",
    );
    return {
      localEntrypoint: "index.html",
      entryUrl: buildCanvasDocumentEntryUrl(documentId, "index.html"),
      sourceMime: sourceMimeResolved,
      sourceFileName,
      viewer: "video",
      ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
      copiedAssets: [source.copied],
    };
  }

  if (input.kind === "vector_image") {
    await fs.writeFile(
      path.join(rootDir, "index.html"),
      buildSvgViewerHtml({
        sourceHref,
        sourceFileName,
        title: input.title,
      }),
      "utf8",
    );
    return {
      localEntrypoint: "index.html",
      entryUrl: buildCanvasDocumentEntryUrl(documentId, "index.html"),
      sourceMime: sourceMimeResolved ?? SVG_MIME,
      sourceFileName,
      viewer: "svg",
      ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
      copiedAssets: [source.copied],
    };
  }

  if (input.kind === "model_3d") {
    const discovered = await discoverModelSidecars(source.originalPath);
    const copiedSidecars = await copyAssets(rootDir, discovered, workspaceDir, seen);
    const format = modelFormatFromFileName(sourceFileName);
    if (!format) {
      throw new Error("canvas 3D model format unsupported");
    }
    const mtlAsset = copiedSidecars.find((asset) => asset.logicalPath.endsWith(".mtl"));
    await fs.writeFile(
      path.join(rootDir, "index.html"),
      buildModelViewerHtml({
        sourceHref,
        sourceFileName,
        title: input.title,
        format,
        ...(mtlAsset ? { mtlHref: encodeAssetHref(mtlAsset.logicalPath) } : {}),
      }),
      "utf8",
    );
    return {
      localEntrypoint: "index.html",
      entryUrl: buildCanvasDocumentEntryUrl(documentId, "index.html"),
      sourceMime: sourceMimeResolved,
      sourceFileName,
      viewer: "threejs",
      viewerOptions: {
        ...input.viewerOptions,
        format,
        ...(mtlAsset ? { mtl: mtlAsset.logicalPath } : {}),
      },
      copiedAssets: [source.copied, ...copiedSidecars],
    };
  }

  if (input.kind === "presentation_asset") {
    const ext = extensionFromPathLike(sourceFileName);
    if (ext === ".pptx") {
      const metadata = await readPptxMetadata(source.localPath);
      await fs.writeFile(
        path.join(rootDir, "index.html"),
        buildPptxViewerHtml({
          sourceHref,
          sourceFileName,
          title: input.title,
          slideCount: metadata.slideCount,
          validationError: metadata.validationError,
        }),
        "utf8",
      );
      return {
        localEntrypoint: "index.html",
        entryUrl: buildCanvasDocumentEntryUrl(documentId, "index.html"),
        sourceMime: sourceMimeResolved ?? PPTX_MIME,
        sourceFileName,
        viewer: metadata.validationError ? "ppt_fallback" : "pptx",
        viewerOptions: {
          ...input.viewerOptions,
          ...(typeof metadata.slideCount === "number" ? { slideCount: metadata.slideCount } : {}),
          ...(metadata.validationError ? { validationError: metadata.validationError } : {}),
        },
        copiedAssets: [source.copied],
      };
    }

    const converted = ext === ".ppt" ? await convertPptToPptx(source.localPath, rootDir) : null;
    if (converted) {
      const convertedMime = PPTX_MIME;
      const stat = await fs.stat(converted.localPath);
      const convertedAsset: CanvasDocumentManifest["assets"][number] = {
        logicalPath: converted.logicalPath,
        contentType: convertedMime,
        sourceFileName: path.basename(converted.localPath),
        sizeBytes: stat.size,
        role: "sidecar",
      };
      seen.add(converted.logicalPath);
      const metadata = await readPptxMetadata(converted.localPath);
      await fs.writeFile(
        path.join(rootDir, "index.html"),
        buildPptxViewerHtml({
          sourceHref: encodeAssetHref(converted.logicalPath),
          sourceFileName: path.basename(converted.localPath),
          title: input.title ?? sourceFileName,
          slideCount: metadata.slideCount,
          validationError: metadata.validationError,
          convertedFrom: sourceFileName,
        }),
        "utf8",
      );
      return {
        localEntrypoint: "index.html",
        entryUrl: buildCanvasDocumentEntryUrl(documentId, "index.html"),
        sourceMime: sourceMimeResolved ?? PPT_MIME,
        sourceFileName,
        viewer: metadata.validationError ? "ppt_fallback" : "pptx",
        viewerOptions: {
          ...input.viewerOptions,
          convertedFrom: sourceFileName,
          converter: converted.converter,
          ...(typeof metadata.slideCount === "number" ? { slideCount: metadata.slideCount } : {}),
          ...(metadata.validationError ? { validationError: metadata.validationError } : {}),
        },
        copiedAssets: [source.copied, convertedAsset],
      };
    }

    await fs.writeFile(
      path.join(rootDir, "index.html"),
      buildPresentationFallbackHtml({
        sourceHref,
        sourceFileName,
        title: input.title,
        reason:
          ext === ".ppt"
            ? "Legacy PPT preview requires LibreOffice or soffice for local conversion, and no converter was found."
            : "This presentation format is not previewable in the browser yet.",
      }),
      "utf8",
    );
    return {
      localEntrypoint: "index.html",
      entryUrl: buildCanvasDocumentEntryUrl(documentId, "index.html"),
      sourceMime: sourceMimeResolved ?? (ext === ".ppt" ? PPT_MIME : undefined),
      sourceFileName,
      viewer: "ppt_fallback",
      ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
      copiedAssets: [source.copied],
    };
  }

  if (input.kind === "document" && isPdfPathLike(sourceFileName)) {
    await fs.writeFile(path.join(rootDir, "index.html"), buildPdfWrapperHtml(sourceHref), "utf8");
    return {
      localEntrypoint: "index.html",
      entryUrl: buildCanvasDocumentEntryUrl(documentId, "index.html"),
      sourceMime: sourceMimeResolved ?? "application/pdf",
      sourceFileName,
      viewer: "pdf",
      ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
      copiedAssets: [source.copied],
    };
  }

  return {
    localEntrypoint: source.logicalPath,
    entryUrl: buildCanvasDocumentEntryUrl(documentId, source.logicalPath),
    sourceMime: sourceMimeResolved,
    sourceFileName,
    viewer: "download",
    ...(input.viewerOptions ? { viewerOptions: input.viewerOptions } : {}),
    copiedAssets: [source.copied],
  };
}

async function publishRevision(documentRoot: string, revisionDir: string): Promise<void> {
  await fs.mkdir(documentRoot, { recursive: true });
  const entries = await fs.readdir(documentRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.name !== CANVAS_REVISIONS_DIR_NAME)
      .map((entry) => fs.rm(path.join(documentRoot, entry.name), { recursive: true, force: true })),
  );
  await fs.cp(revisionDir, documentRoot, { recursive: true, force: true });
}

async function materializeCanvasDocumentRevision(params: {
  id: string;
  input: CanvasDocumentCreateInput;
  revision: number;
  previous?: CanvasDocumentManifest | null;
  workspaceDir: string;
  stateDir?: string;
  canvasRootDir?: string;
}): Promise<CanvasDocumentManifest> {
  const rootDir = resolveCanvasDocumentDir(params.id, {
    stateDir: params.stateDir,
    rootDir: params.canvasRootDir,
  });
  const revisionDir = resolveCanvasDocumentRevisionDir(params.id, params.revision, {
    stateDir: params.stateDir,
    rootDir: params.canvasRootDir,
  });
  await fs.rm(revisionDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(revisionDir, { recursive: true });
  const seen = new Set<string>();
  const entry = await materializeEntrypoint(
    revisionDir,
    params.input,
    params.workspaceDir,
    params.id,
    seen,
  );
  const extraAssets = await copyAssets(revisionDir, params.input.assets, params.workspaceDir, seen);
  const now = new Date().toISOString();
  const manifest: CanvasDocumentManifest = {
    id: params.id,
    kind: params.input.kind,
    ...(params.input.title?.trim() ? { title: params.input.title.trim() } : {}),
    ...(typeof params.input.preferredHeight === "number"
      ? { preferredHeight: params.input.preferredHeight }
      : {}),
    ...(params.input.surface ? { surface: params.input.surface } : {}),
    createdAt: params.previous?.createdAt ?? now,
    ...(params.previous ? { updatedAt: now } : {}),
    revision: params.revision,
    entryUrl: entry.entryUrl,
    ...(entry.localEntrypoint ? { localEntrypoint: entry.localEntrypoint } : {}),
    ...(entry.externalUrl ? { externalUrl: entry.externalUrl } : {}),
    ...(entry.sourceMime ? { sourceMime: entry.sourceMime } : {}),
    ...(entry.sourceFileName ? { sourceFileName: entry.sourceFileName } : {}),
    ...(entry.viewer ? { viewer: entry.viewer } : {}),
    ...(entry.viewerOptions ? { viewerOptions: entry.viewerOptions } : {}),
    assets: [...entry.copiedAssets, ...extraAssets],
  };
  await writeManifest(revisionDir, manifest);
  await publishRevision(rootDir, revisionDir);
  return manifest;
}

export async function createCanvasDocument(
  input: CanvasDocumentCreateInput,
  options?: { stateDir?: string; workspaceDir?: string; canvasRootDir?: string },
): Promise<CanvasDocumentManifest> {
  const workspaceDir = options?.workspaceDir ?? process.cwd();
  const id = input.id?.trim() ? normalizeCanvasDocumentId(input.id) : canvasDocumentId();
  const rootDir = resolveCanvasDocumentDir(id, {
    stateDir: options?.stateDir,
    rootDir: options?.canvasRootDir,
  });
  await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(rootDir, { recursive: true });
  return await materializeCanvasDocumentRevision({
    id,
    input,
    revision: 1,
    workspaceDir,
    stateDir: options?.stateDir,
    canvasRootDir: options?.canvasRootDir,
  });
}

export async function updateCanvasDocument(
  input: CanvasDocumentCreateInput & { id: string },
  options?: { stateDir?: string; workspaceDir?: string; canvasRootDir?: string },
): Promise<CanvasDocumentManifest> {
  const workspaceDir = options?.workspaceDir ?? process.cwd();
  const id = normalizeCanvasDocumentId(input.id);
  const previous = await loadCanvasDocumentManifest(id, {
    stateDir: options?.stateDir,
    canvasRootDir: options?.canvasRootDir,
  });
  if (!previous) {
    throw new Error("canvas document not found");
  }
  return await materializeCanvasDocumentRevision({
    id,
    input,
    revision: Math.max(1, previous.revision ?? 1) + 1,
    previous,
    workspaceDir,
    stateDir: options?.stateDir,
    canvasRootDir: options?.canvasRootDir,
  });
}

export async function loadCanvasDocumentManifest(
  documentId: string,
  options?: { stateDir?: string; canvasRootDir?: string },
): Promise<CanvasDocumentManifest | null> {
  const id = normalizeCanvasDocumentId(documentId);
  const manifestPath = path.join(
    resolveCanvasDocumentDir(id, {
      stateDir: options?.stateDir,
      rootDir: options?.canvasRootDir,
    }),
    "manifest.json",
  );
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as CanvasDocumentManifest)
      : null;
  } catch {
    return null;
  }
}

export function resolveCanvasDocumentAssets(
  manifest: CanvasDocumentManifest,
  options?: { baseUrl?: string; stateDir?: string; canvasRootDir?: string },
): CanvasDocumentResolvedAsset[] {
  const baseUrl = options?.baseUrl?.trim().replace(/\/+$/, "");
  const documentDir = resolveCanvasDocumentDir(manifest.id, {
    stateDir: options?.stateDir,
    rootDir: options?.canvasRootDir,
  });
  return manifest.assets.map((asset) => ({
    logicalPath: asset.logicalPath,
    ...(asset.contentType ? { contentType: asset.contentType } : {}),
    localPath: path.join(documentDir, asset.logicalPath),
    url: baseUrl
      ? `${baseUrl}${buildCanvasDocumentAssetUrl(manifest.id, asset.logicalPath)}`
      : buildCanvasDocumentAssetUrl(manifest.id, asset.logicalPath),
  }));
}
