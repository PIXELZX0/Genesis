import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createTranscriptSequenceTracker } from "./session-transcript-sequence.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTranscriptPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-transcript-sequence-"));
  cleanupDirs.push(dir);
  return path.join(dir, "session.jsonl");
}

function header(id = "session") {
  return JSON.stringify({ type: "session", version: 1, id });
}

function message(id: string, text = id) {
  return JSON.stringify({
    type: "message",
    id,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: 1,
    },
  });
}

function compaction(id: string) {
  return JSON.stringify({
    type: "compaction",
    id,
    summary: "summary",
    firstKeptEntryId: id,
    tokensBefore: 100,
  });
}

function custom(id: string) {
  return JSON.stringify({ type: "custom", id, customType: "test", data: {} });
}

describe("transcript sequence checkpoints", () => {
  test("reads only bounded checkpoint and suffix bytes for warm appends", () => {
    const sessionFile = createTranscriptPath();
    const lines = [header()];
    for (let index = 0; index < 2_000; index += 1) {
      lines.push(message(`message-${index}`, "x".repeat(256)));
    }
    fs.writeFileSync(sessionFile, `${lines.join("\n")}\n`, "utf8");
    const initialBytes = fs.statSync(sessionFile).size;
    const tracker = createTranscriptSequenceTracker();
    const target = { sessionId: "session", sessionFile };

    expect(tracker.read(target)).toBe(2_000);
    fs.appendFileSync(sessionFile, `${message("message-next")}\n`, "utf8");
    const readSpy = vi.spyOn(fs, "readSync");

    expect(tracker.read(target)).toBe(2_001);
    const requestedBytes = (readSpy.mock.calls as unknown[][]).reduce((total, call) => {
      const length = call[3];
      return total + (typeof length === "number" ? length : 0);
    }, 0);
    expect(requestedBytes).toBeLessThan(4 * 1024);
    expect(requestedBytes).toBeLessThan(initialBytes / 100);
  });

  test("rebuilds safely across compaction, truncation, rewrite, and replacement", () => {
    const sessionFile = createTranscriptPath();
    const tracker = createTranscriptSequenceTracker();
    const target = { sessionId: "session", sessionFile };
    fs.writeFileSync(
      sessionFile,
      `${[header(), message("message-1"), custom("custom-1"), compaction("compact-1")].join("\n")}\n`,
      "utf8",
    );

    expect(tracker.read(target)).toBe(2);
    fs.appendFileSync(sessionFile, `${custom("custom-2")}\n${message("message-2")}\n`, "utf8");
    expect(tracker.read(target)).toBe(3);

    fs.truncateSync(sessionFile, Buffer.byteLength(`${header()}\n`, "utf8"));
    expect(tracker.read(target)).toBe(0);
    fs.appendFileSync(sessionFile, `${compaction("compact-2")}\n${message("message-3")}\n`, "utf8");
    expect(tracker.read(target)).toBe(2);

    const replacement = `${sessionFile}.replacement`;
    fs.writeFileSync(
      replacement,
      `${[
        header("replacement"),
        message("message-a"),
        compaction("compact-a"),
        custom("custom-a"),
        message("message-b"),
      ].join("\n")}\n`,
      "utf8",
    );
    fs.renameSync(replacement, sessionFile);
    expect(tracker.read(target)).toBe(3);

    fs.writeFileSync(sessionFile, `${header("rewritten")}\n${message("message-final")}\n`, "utf8");
    tracker.invalidate(sessionFile);
    expect(tracker.read(target)).toBe(1);
  });

  test("rejects a checkpoint after a same-size in-place rewrite", () => {
    const sessionFile = createTranscriptPath();
    const tracker = createTranscriptSequenceTracker();
    const target = { sessionId: "session", sessionFile };
    const firstMessage = message("message-1");
    const original = `${header()}\n${firstMessage}\n${message("message-2", "x".repeat(512))}\n`;
    fs.writeFileSync(sessionFile, original, "utf8");

    expect(tracker.read(target)).toBe(2);
    const originalStat = fs.statSync(sessionFile);
    const rewrittenPrefix = `${header()}\n${firstMessage}\n`;
    const emptyPaddingRecord = `${JSON.stringify({
      type: "custom",
      id: "padding",
      data: "",
    })}\n`;
    const paddingBytes =
      Buffer.byteLength(original, "utf8") -
      Buffer.byteLength(rewrittenPrefix, "utf8") -
      Buffer.byteLength(emptyPaddingRecord, "utf8");
    expect(paddingBytes).toBeGreaterThan(0);
    const rewritten = `${rewrittenPrefix}${JSON.stringify({
      type: "custom",
      id: "padding",
      data: "x".repeat(paddingBytes),
    })}\n`;
    expect(Buffer.byteLength(rewritten, "utf8")).toBe(Buffer.byteLength(original, "utf8"));

    fs.writeFileSync(sessionFile, rewritten, "utf8");
    const changedTime = new Date(originalStat.mtimeMs + 2_000);
    fs.utimesSync(sessionFile, changedTime, changedTime);
    expect(tracker.read(target)).toBe(1);
  });
});
