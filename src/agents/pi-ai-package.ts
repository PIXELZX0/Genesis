import fs from "node:fs/promises";
import { createRequire } from "node:module";

/**
 * Return the mtime (in milliseconds) of the installed `@earendil-works/pi-ai`
 * package manifest, or `null` if the package is not present or unreadable.
 */
export async function readPiAiPackageMtimeMs(): Promise<number | null> {
  try {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve("@earendil-works/pi-ai/package.json");
    const stat = await fs.stat(packageJsonPath);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}
