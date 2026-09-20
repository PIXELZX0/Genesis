/**
 * Strip model control tokens leaked into assistant text output.
 *
 * Models like GLM-5 and DeepSeek sometimes emit internal delimiter tokens
 * (e.g. `<|assistant|>`, `<|tool_call_result_begin|>`, `<｜begin▁of▁sentence｜>`)
 * in their responses. These use the universal `<|...|>` convention (ASCII or
 * full-width pipe variants) and should never reach end users.
 *
 * Matches inside fenced code blocks or inline code spans are preserved so
 * that documentation / examples that reference these tokens are not corrupted.
 *
 * This is a provider bug — no upstream fix tracked yet.
 * Remove this function when upstream providers stop leaking tokens.
 * @see https://github.com/PIXELZX0/Genesis/issues/40020
 */
import { findCodeRegions, isInsideCode } from "./code-regions.js";

// Match both ASCII pipe <|...|> and full-width pipe <｜...｜> (U+FF5C) variants.
const MODEL_SPECIAL_TOKEN_RE = /<[|｜][^|｜]*[|｜]>/g;
// DeepSeek falls back to a DSML markup block when the transport has no native
// tool calling. Its tags carry a name after the closing pipe
// (`<｜DSML｜tool_calls>`), so MODEL_SPECIAL_TOKEN_RE never matches them, and
// the block body is machine markup, not prose: drop the whole block, including
// an unterminated one left by a truncated stream.
const DSML_TOOL_CALL_BLOCK_RE =
  /<[|｜]DSML[|｜]tool_calls>[\s\S]*?(?:<\/[|｜]DSML[|｜]tool_calls>|$)/g;
// Leftover DSML tags when the opening block tag arrived in an earlier chunk.
const DSML_TAG_RE = /<\/?[|｜]DSML[|｜][^<>]*>/g;
const LEAKED_TOKEN_QUICK_RE = /<\/?[|｜]/;

type CodeRegion = { start: number; end: number };

function overlapsCodeRegion(start: number, end: number, codeRegions: CodeRegion[]): boolean {
  return codeRegions.some((region) => start < region.end && end > region.start);
}

function shouldInsertSeparator(before: string | undefined, after: string | undefined): boolean {
  return Boolean(before && after && !/\s/.test(before) && !/\s/.test(after));
}

function stripMatchesOutsideCode(text: string, pattern: RegExp, codeRegions: CodeRegion[]): string {
  pattern.lastIndex = 0;
  if (!pattern.test(text)) {
    return text;
  }
  pattern.lastIndex = 0;

  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const matched = match[0];
    const start = match.index ?? 0;
    const end = start + matched.length;
    out += text.slice(cursor, start);
    if (isInsideCode(start, codeRegions) || overlapsCodeRegion(start, end, codeRegions)) {
      out += matched;
    } else if (shouldInsertSeparator(text[start - 1], text[end])) {
      out += " ";
    }
    cursor = end;
  }
  out += text.slice(cursor);
  return out;
}

export function stripModelSpecialTokens(text: string): string {
  if (!text || !LEAKED_TOKEN_QUICK_RE.test(text)) {
    return text;
  }

  // Code regions are resolved against the original text, so each stage re-reads
  // them from the value it is about to strip.
  let cleaned = stripMatchesOutsideCode(text, DSML_TOOL_CALL_BLOCK_RE, findCodeRegions(text));
  cleaned = stripMatchesOutsideCode(cleaned, DSML_TAG_RE, findCodeRegions(cleaned));
  return stripMatchesOutsideCode(cleaned, MODEL_SPECIAL_TOKEN_RE, findCodeRegions(cleaned));
}
