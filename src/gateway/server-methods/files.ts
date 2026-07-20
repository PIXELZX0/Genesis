import fs from "node:fs/promises";
import path from "node:path";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateFilesDeleteParams,
  validateFilesListParams,
  validateFilesMkdirParams,
  validateFilesReadParams,
  validateFilesRenameParams,
  validateFilesWriteParams,
} from "../protocol/index.js";
import type { FilesEntry, FilesReadResult } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

// ponytail: base64-over-RPC caps; add a streaming HTTP route if >10MB transfers are needed.
const MAX_TEXT_BYTES = 1 * 1024 * 1024;
const MAX_BASE64_BYTES = 10 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 4096;

function respondInvalidParams(
  respond: RespondFn,
  method: string,
  errors: Parameters<typeof formatValidationErrors>[0],
): void {
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} params: ${formatValidationErrors(errors)}`,
    ),
  );
}

function resolveAbsolutePath(respond: RespondFn, rawPath: string): string | undefined {
  if (!path.isAbsolute(rawPath)) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path must be absolute"));
    return undefined;
  }
  return path.resolve(rawPath);
}

function respondFsError(respond: RespondFn, err: unknown): void {
  const code = (err as NodeJS.ErrnoException)?.code;
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "filesystem error";
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message, { details: { code } }));
}

function looksBinary(buffer: Buffer): boolean {
  const sniff = buffer.subarray(0, BINARY_SNIFF_BYTES);
  return sniff.includes(0);
}

function entryType(dirent: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): FilesEntry["type"] {
  if (dirent.isDirectory()) {
    return "dir";
  }
  if (dirent.isFile()) {
    return "file";
  }
  if (dirent.isSymbolicLink()) {
    return "symlink";
  }
  return "other";
}

export const filesHandlers: GatewayRequestHandlers = {
  "files.list": async ({ params, respond }) => {
    if (!validateFilesListParams(params)) {
      respondInvalidParams(respond, "files.list", validateFilesListParams.errors);
      return;
    }
    const dirPath = resolveAbsolutePath(respond, params.path);
    if (!dirPath) {
      return;
    }
    try {
      const dirents = await fs.readdir(dirPath, { withFileTypes: true });
      const entries: FilesEntry[] = await Promise.all(
        dirents.map(async (dirent) => {
          const entry: FilesEntry = { name: dirent.name, type: entryType(dirent) };
          try {
            const stat = await fs.stat(path.join(dirPath, dirent.name));
            entry.size = stat.size;
            entry.mtimeMs = Math.floor(stat.mtimeMs);
            if (dirent.isSymbolicLink()) {
              entry.type = stat.isDirectory() ? "dir" : "symlink";
            }
          } catch {
            // Broken symlink or permission error: keep the bare entry.
          }
          return entry;
        }),
      );
      entries.sort((a, b) => {
        if ((a.type === "dir") !== (b.type === "dir")) {
          return a.type === "dir" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      respond(true, { path: dirPath, entries }, undefined);
    } catch (err) {
      respondFsError(respond, err);
    }
  },
  "files.read": async ({ params, respond }) => {
    if (!validateFilesReadParams(params)) {
      respondInvalidParams(respond, "files.read", validateFilesReadParams.errors);
      return;
    }
    const filePath = resolveAbsolutePath(respond, params.path);
    if (!filePath) {
      return;
    }
    const encoding = params.encoding ?? "utf8";
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "not a regular file"));
        return;
      }
      const maxBytes = encoding === "utf8" ? MAX_TEXT_BYTES : MAX_BASE64_BYTES;
      if (stat.size > maxBytes) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `file too large (${stat.size} bytes; max ${maxBytes})`,
          ),
        );
        return;
      }
      const buffer = await fs.readFile(filePath);
      if (encoding === "utf8" && looksBinary(buffer)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "binary file; use base64 download"),
        );
        return;
      }
      const result: FilesReadResult = {
        path: filePath,
        size: stat.size,
        mtimeMs: Math.floor(stat.mtimeMs),
        encoding,
        content: buffer.toString(encoding),
      };
      respond(true, result, undefined);
    } catch (err) {
      respondFsError(respond, err);
    }
  },
  "files.write": async ({ params, respond }) => {
    if (!validateFilesWriteParams(params)) {
      respondInvalidParams(respond, "files.write", validateFilesWriteParams.errors);
      return;
    }
    const filePath = resolveAbsolutePath(respond, params.path);
    if (!filePath) {
      return;
    }
    const encoding = params.encoding ?? "utf8";
    const buffer = Buffer.from(params.content, encoding);
    if (buffer.byteLength > MAX_BASE64_BYTES) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `content too large (${buffer.byteLength} bytes; max ${MAX_BASE64_BYTES})`,
        ),
      );
      return;
    }
    try {
      await fs.writeFile(filePath, buffer, {
        flag: params.overwrite === false ? "wx" : "w",
      });
      const stat = await fs.stat(filePath);
      respond(
        true,
        { ok: true, path: filePath, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) },
        undefined,
      );
    } catch (err) {
      respondFsError(respond, err);
    }
  },
  "files.delete": async ({ params, respond }) => {
    if (!validateFilesDeleteParams(params)) {
      respondInvalidParams(respond, "files.delete", validateFilesDeleteParams.errors);
      return;
    }
    const target = resolveAbsolutePath(respond, params.path);
    if (!target) {
      return;
    }
    if (target === path.parse(target).root) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "refusing to delete filesystem root"),
      );
      return;
    }
    try {
      await fs.rm(target, { recursive: params.recursive === true });
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respondFsError(respond, err);
    }
  },
  "files.rename": async ({ params, respond }) => {
    if (!validateFilesRenameParams(params)) {
      respondInvalidParams(respond, "files.rename", validateFilesRenameParams.errors);
      return;
    }
    const from = resolveAbsolutePath(respond, params.path);
    if (!from) {
      return;
    }
    const to = resolveAbsolutePath(respond, params.newPath);
    if (!to) {
      return;
    }
    try {
      await fs.rename(from, to);
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respondFsError(respond, err);
    }
  },
  "files.mkdir": async ({ params, respond }) => {
    if (!validateFilesMkdirParams(params)) {
      respondInvalidParams(respond, "files.mkdir", validateFilesMkdirParams.errors);
      return;
    }
    const dirPath = resolveAbsolutePath(respond, params.path);
    if (!dirPath) {
      return;
    }
    try {
      await fs.mkdir(dirPath, { recursive: true });
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respondFsError(respond, err);
    }
  },
};
