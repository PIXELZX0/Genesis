import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveDefaultAgentId, type GenesisPluginApi } from "../api.js";
import { BoardModelSchema } from "./model/schema.js";
import type { BoardModel } from "./model/types.js";
import { NetlistSchema, type Netlist } from "./netlist/schema.js";

type ToolContext = { workspaceDir?: string; agentId?: string };

export type WorkspaceParams = { api: GenesisPluginApi; ctx?: ToolContext };

export function resolveWorkspaceDir(params: WorkspaceParams): string {
  return (
    params.ctx?.workspaceDir ||
    params.api.runtime.agent.resolveAgentWorkspaceDir(
      params.api.config,
      params.ctx?.agentId ?? resolveDefaultAgentId(params.api.config),
    )
  );
}

/** Normalize a user-supplied board name into a filesystem-safe slug. */
export function slugifyBoardName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!slug) {
    throw new Error("board name required");
  }
  return slug;
}

export function pcbRootDir(workspaceDir: string): string {
  return path.join(workspaceDir, "pcb");
}

export function boardDir(workspaceDir: string, name: string): string {
  return path.join(pcbRootDir(workspaceDir), slugifyBoardName(name));
}

export function boardJsonPath(workspaceDir: string, name: string): string {
  return path.join(boardDir(workspaceDir, name), "board.json");
}

export function netlistJsonPath(workspaceDir: string, name: string): string {
  return path.join(boardDir(workspaceDir, name), "netlist.json");
}

export function gerbersDir(workspaceDir: string, name: string): string {
  return path.join(boardDir(workspaceDir, name), "gerbers");
}

export function previewSvgPath(workspaceDir: string, name: string): string {
  return path.join(boardDir(workspaceDir, name), "preview.svg");
}

const locks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(
    key,
    previous.then(() => next),
  );
  await previous;
  try {
    return await task();
  } finally {
    release?.();
    if (locks.get(key) === next) {
      locks.delete(key);
    }
  }
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}-${randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function boardExists(workspaceDir: string, name: string): Promise<boolean> {
  try {
    await fs.access(boardJsonPath(workspaceDir, name));
    return true;
  } catch {
    return false;
  }
}

export async function readBoard(workspaceDir: string, name: string): Promise<BoardModel> {
  const raw = await fs.readFile(boardJsonPath(workspaceDir, name), "utf8");
  return BoardModelSchema.parse(JSON.parse(raw));
}

export async function writeBoard(workspaceDir: string, board: BoardModel): Promise<void> {
  const validated = BoardModelSchema.parse(board);
  await withLock(boardJsonPath(workspaceDir, validated.name), async () => {
    await atomicWriteJson(boardJsonPath(workspaceDir, validated.name), validated);
  });
}

/** Read-modify-write a board under its per-name lock. */
export async function mutateBoard(
  workspaceDir: string,
  name: string,
  mutate: (board: BoardModel) => BoardModel | Promise<BoardModel>,
): Promise<BoardModel> {
  return await withLock(boardJsonPath(workspaceDir, name), async () => {
    const raw = await fs.readFile(boardJsonPath(workspaceDir, name), "utf8");
    const board = BoardModelSchema.parse(JSON.parse(raw));
    const next = BoardModelSchema.parse(await mutate(board));
    await atomicWriteJson(boardJsonPath(workspaceDir, name), next);
    return next;
  });
}

export async function listBoards(workspaceDir: string): Promise<string[]> {
  let entries: string[];
  try {
    const dirents = await fs.readdir(pcbRootDir(workspaceDir), { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const boards: string[] = [];
  for (const entry of entries) {
    try {
      await fs.access(path.join(pcbRootDir(workspaceDir), entry, "board.json"));
      boards.push(entry);
    } catch {
      // Skip directories without a board.json.
    }
  }
  return boards.toSorted();
}

export async function writeNetlist(
  workspaceDir: string,
  name: string,
  netlist: Netlist,
): Promise<void> {
  await atomicWriteJson(netlistJsonPath(workspaceDir, name), NetlistSchema.parse(netlist));
}

export async function readNetlist(
  workspaceDir: string,
  name: string,
): Promise<Netlist | undefined> {
  try {
    const raw = await fs.readFile(netlistJsonPath(workspaceDir, name), "utf8");
    return NetlistSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
