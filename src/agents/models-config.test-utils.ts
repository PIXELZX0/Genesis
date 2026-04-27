import fs from "node:fs/promises";
import path from "node:path";
import { resolveGenesisAgentDir } from "./agent-paths.js";

export async function readGeneratedModelsJson<T>(agentDir = resolveGenesisAgentDir()): Promise<T> {
  const modelPath = path.join(agentDir, "models.json");
  const raw = await fs.readFile(modelPath, "utf8");
  return JSON.parse(raw) as T;
}
