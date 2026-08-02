import fs from "node:fs";
import path from "node:path";
import { resolveSessionTranscriptCandidates } from "./session-transcript-files.fs.js";

const TRANSCRIPT_SEQUENCE_READ_CHUNK_BYTES = 64 * 1024;
const TRANSCRIPT_SEQUENCE_VERIFY_BYTES = 512;
const DEFAULT_TRANSCRIPT_SEQUENCE_CHECKPOINT_LIMIT = 500;

type TranscriptSequenceCheckpoint = {
  count: number;
  offset: number;
  fileSize: number;
  mtimeMs: number;
  dev: number;
  ino: number;
  prefix: Buffer;
  boundary: Buffer;
};

type TranscriptSequenceTarget = {
  sessionId: string;
  storePath?: string;
  sessionFile?: string;
};

export type TranscriptSequenceTracker = {
  read(target: TranscriptSequenceTarget): number;
  invalidate(sessionFile: string): void;
};

function isSequenceRecord(line: Buffer): boolean {
  if (line.length === 0) {
    return false;
  }
  try {
    const parsed = JSON.parse(line.toString("utf8")) as {
      message?: unknown;
      type?: unknown;
    } | null;
    return Boolean(parsed?.message) || parsed?.type === "compaction";
  } catch {
    return false;
  }
}

function readWindow(fd: number, start: number, length: number): Buffer {
  if (length <= 0) {
    return Buffer.alloc(0);
  }
  const buffer = Buffer.allocUnsafe(length);
  const bytesRead = fs.readSync(fd, buffer, 0, length, start);
  return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
}

function readCheckpointWindow(fd: number, offset: number): Buffer {
  const length = Math.min(offset, TRANSCRIPT_SEQUENCE_VERIFY_BYTES);
  return readWindow(fd, offset - length, length);
}

function canResumeFromCheckpoint(params: {
  fd: number;
  stat: fs.Stats;
  checkpoint: TranscriptSequenceCheckpoint;
}): boolean {
  const { checkpoint, stat } = params;
  if (
    checkpoint.dev !== stat.dev ||
    checkpoint.ino !== stat.ino ||
    checkpoint.offset > stat.size ||
    checkpoint.fileSize > stat.size
  ) {
    return false;
  }
  // A same-sized file with a new timestamp was rewritten, not appended.
  if (checkpoint.fileSize === stat.size && checkpoint.mtimeMs !== stat.mtimeMs) {
    return false;
  }
  const prefix = readWindow(params.fd, 0, checkpoint.prefix.length);
  if (!prefix.equals(checkpoint.prefix)) {
    return false;
  }
  const boundary = readCheckpointWindow(params.fd, checkpoint.offset);
  return boundary.equals(checkpoint.boundary);
}

function scanSequenceRecords(params: {
  fd: number;
  startOffset: number;
  endOffset: number;
  initialCount: number;
}): { checkpointCount: number; checkpointOffset: number; sequence: number; bytesReadTo: number } {
  let count = params.initialCount;
  let checkpointOffset = params.startOffset;
  let readOffset = params.startOffset;
  let pendingFragments: Buffer[] = [];
  let pendingBytes = 0;

  while (readOffset < params.endOffset) {
    const requestedBytes = Math.min(
      TRANSCRIPT_SEQUENCE_READ_CHUNK_BYTES,
      params.endOffset - readOffset,
    );
    const chunk = Buffer.allocUnsafe(requestedBytes);
    const bytesRead = fs.readSync(params.fd, chunk, 0, requestedBytes, readOffset);
    if (bytesRead <= 0) {
      break;
    }
    const data = chunk.subarray(0, bytesRead);
    let lineStart = 0;
    while (lineStart < data.length) {
      const newline = data.indexOf(0x0a, lineStart);
      if (newline < 0) {
        const fragment = Buffer.from(data.subarray(lineStart));
        pendingFragments.push(fragment);
        pendingBytes += fragment.length;
        break;
      }
      const fragment = data.subarray(lineStart, newline);
      const line =
        pendingFragments.length === 0
          ? fragment
          : Buffer.concat([...pendingFragments, fragment], pendingBytes + fragment.length);
      if (isSequenceRecord(line)) {
        count += 1;
      }
      pendingFragments = [];
      pendingBytes = 0;
      lineStart = newline + 1;
      checkpointOffset = readOffset + lineStart;
    }
    readOffset += bytesRead;
  }

  const trailingLine =
    pendingFragments.length === 0 ? Buffer.alloc(0) : Buffer.concat(pendingFragments, pendingBytes);
  return {
    checkpointCount: count,
    checkpointOffset,
    sequence: count + (isSequenceRecord(trailingLine) ? 1 : 0),
    bytesReadTo: readOffset,
  };
}

function resolveExistingTranscriptPath(target: TranscriptSequenceTarget): string | undefined {
  return resolveSessionTranscriptCandidates(
    target.sessionId,
    target.storePath,
    target.sessionFile,
  ).find((candidate) => fs.existsSync(candidate));
}

export function createTranscriptSequenceTracker(options?: {
  maxCheckpoints?: number;
}): TranscriptSequenceTracker {
  const checkpoints = new Map<string, TranscriptSequenceCheckpoint>();
  const maxCheckpoints = Math.max(
    1,
    Math.floor(options?.maxCheckpoints ?? DEFAULT_TRANSCRIPT_SEQUENCE_CHECKPOINT_LIMIT),
  );

  const writeCheckpoint = (key: string, checkpoint: TranscriptSequenceCheckpoint): void => {
    checkpoints.delete(key);
    checkpoints.set(key, checkpoint);
    while (checkpoints.size > maxCheckpoints) {
      const oldest = checkpoints.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      checkpoints.delete(oldest);
    }
  };

  return {
    read: (target) => {
      const transcriptPath = resolveExistingTranscriptPath(target);
      if (!transcriptPath) {
        return 0;
      }
      const cacheKey = path.resolve(transcriptPath);
      const fd = fs.openSync(transcriptPath, "r");
      try {
        const stat = fs.fstatSync(fd);
        const checkpoint = checkpoints.get(cacheKey);
        const canResume =
          checkpoint !== undefined && canResumeFromCheckpoint({ fd, stat, checkpoint });
        const initialCount = canResume ? checkpoint.count : 0;
        const startOffset = canResume ? checkpoint.offset : 0;
        const scan = scanSequenceRecords({
          fd,
          startOffset,
          endOffset: stat.size,
          initialCount,
        });
        const verifiedPrefixLength = Math.min(
          scan.checkpointOffset,
          TRANSCRIPT_SEQUENCE_VERIFY_BYTES,
        );
        writeCheckpoint(cacheKey, {
          count: scan.checkpointCount,
          offset: scan.checkpointOffset,
          fileSize: scan.bytesReadTo,
          mtimeMs: stat.mtimeMs,
          dev: stat.dev,
          ino: stat.ino,
          prefix: readWindow(fd, 0, verifiedPrefixLength),
          boundary: readCheckpointWindow(fd, scan.checkpointOffset),
        });
        return scan.sequence;
      } finally {
        fs.closeSync(fd);
      }
    },
    invalidate: (sessionFile) => {
      const trimmed = sessionFile.trim();
      if (trimmed) {
        checkpoints.delete(path.resolve(trimmed));
      }
    },
  };
}
