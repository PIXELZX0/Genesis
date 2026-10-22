import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";

const CONTEXT_FILE_ORDER = new Map<string, number>([
  ["agents.md", 10],
  ["soul.md", 20],
  ["identity.md", 30],
  ["user.md", 40],
  ["tools.md", 50],
  ["bootstrap.md", 60],
  ["memory.md", 70],
]);

function normalizeContextFilePath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, "/");
}

function getContextFileBasename(pathValue: string): string {
  const normalizedPath = normalizeContextFilePath(pathValue);
  return normalizeLowercaseStringOrEmpty(normalizedPath.split("/").pop() ?? normalizedPath);
}

function sortContextFilesForPrompt(contextFiles: EmbeddedContextFile[]): EmbeddedContextFile[] {
  return contextFiles.toSorted((a, b) => {
    const aPath = normalizeContextFilePath(a.path);
    const bPath = normalizeContextFilePath(b.path);
    const aBase = getContextFileBasename(a.path);
    const bBase = getContextFileBasename(b.path);
    const aOrder = CONTEXT_FILE_ORDER.get(aBase) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = CONTEXT_FILE_ORDER.get(bBase) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if (aBase !== bBase) {
      return aBase.localeCompare(bBase);
    }
    return aPath.localeCompare(bPath);
  });
}

/**
 * The `# Project Context` block exactly as it appears in the assembled system prompt
 * (undefined without context files). Shared with the `/context` size report.
 */
export function buildProjectContextPrompt(
  contextFiles: EmbeddedContextFile[] = [],
): string | undefined {
  const files = sortContextFilesForPrompt(
    contextFiles.filter((file) => typeof file.path === "string" && file.path.trim().length > 0),
  );
  if (files.length === 0) {
    return undefined;
  }
  const lines = ["# Project Context", ""];
  const hasSoulFile = files.some((file) => getContextFileBasename(file.path) === "soul.md");
  lines.push("The following project context files have been loaded:");
  if (hasSoulFile) {
    lines.push(
      "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
    );
  }
  lines.push("");
  for (const file of files) {
    lines.push(`## ${file.path}`, "", file.content, "");
  }
  // The assembled prompt drops empty lines the same way.
  return lines.filter(Boolean).join("\n");
}
