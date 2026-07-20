import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filesHandlers } from "./files.js";

async function invoke(method: string, params: Record<string, unknown>) {
  let response: unknown[] | undefined;
  await filesHandlers[method]({
    params,
    respond: (...args: unknown[]) => {
      response = args;
    },
  } as never);
  return response as [boolean, unknown, { message?: string } | undefined];
}

describe("files gateway methods", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-files-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects relative paths", async () => {
    const [ok, , err] = await invoke("files.list", { path: "relative/path" });
    expect(ok).toBe(false);
    expect(err?.message).toContain("absolute");
  });

  it("lists a directory with dirs first", async () => {
    await fs.writeFile(path.join(dir, "b.txt"), "hi");
    await fs.mkdir(path.join(dir, "a-dir"));
    const [ok, payload] = await invoke("files.list", { path: dir });
    expect(ok).toBe(true);
    const { entries } = payload as { entries: { name: string; type: string }[] };
    expect(entries.map((e) => e.name)).toEqual(["a-dir", "b.txt"]);
    expect(entries[0]?.type).toBe("dir");
  });

  it("writes and reads a text file roundtrip", async () => {
    const filePath = path.join(dir, "note.txt");
    const [wroteOk] = await invoke("files.write", { path: filePath, content: "hello" });
    expect(wroteOk).toBe(true);
    const [readOk, payload] = await invoke("files.read", { path: filePath });
    expect(readOk).toBe(true);
    expect((payload as { content: string }).content).toBe("hello");
  });

  it("refuses utf8 read of a binary file", async () => {
    const filePath = path.join(dir, "bin.dat");
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x00, 0x47]));
    const [ok, , err] = await invoke("files.read", { path: filePath });
    expect(ok).toBe(false);
    expect(err?.message).toContain("binary");
  });

  it("serves binary content via base64", async () => {
    const filePath = path.join(dir, "bin.dat");
    const bytes = Buffer.from([0x00, 0x01, 0x02]);
    await fs.writeFile(filePath, bytes);
    const [ok, payload] = await invoke("files.read", { path: filePath, encoding: "base64" });
    expect(ok).toBe(true);
    expect((payload as { content: string }).content).toBe(bytes.toString("base64"));
  });

  it("refuses utf8 read above the text size cap", async () => {
    const filePath = path.join(dir, "big.txt");
    await fs.writeFile(filePath, "x".repeat(1024 * 1024 + 1));
    const [ok, , err] = await invoke("files.read", { path: filePath });
    expect(ok).toBe(false);
    expect(err?.message).toContain("too large");
  });

  it("refuses overwrite when overwrite=false", async () => {
    const filePath = path.join(dir, "exists.txt");
    await fs.writeFile(filePath, "old");
    const [ok] = await invoke("files.write", {
      path: filePath,
      content: "new",
      overwrite: false,
    });
    expect(ok).toBe(false);
    expect(await fs.readFile(filePath, "utf8")).toBe("old");
  });

  it("deletes a non-empty dir only with recursive", async () => {
    const sub = path.join(dir, "sub");
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, "f.txt"), "x");
    const [plainOk] = await invoke("files.delete", { path: sub });
    expect(plainOk).toBe(false);
    const [recursiveOk] = await invoke("files.delete", { path: sub, recursive: true });
    expect(recursiveOk).toBe(true);
    await expect(fs.stat(sub)).rejects.toThrow();
  });

  it("refuses deleting the filesystem root", async () => {
    const [ok, , err] = await invoke("files.delete", { path: path.parse(dir).root });
    expect(ok).toBe(false);
    expect(err?.message).toContain("root");
  });

  it("renames a file", async () => {
    const from = path.join(dir, "old.txt");
    const to = path.join(dir, "new.txt");
    await fs.writeFile(from, "x");
    const [ok] = await invoke("files.rename", { path: from, newPath: to });
    expect(ok).toBe(true);
    expect(await fs.readFile(to, "utf8")).toBe("x");
  });

  it("creates nested directories", async () => {
    const nested = path.join(dir, "a", "b");
    const [ok] = await invoke("files.mkdir", { path: nested });
    expect(ok).toBe(true);
    expect((await fs.stat(nested)).isDirectory()).toBe(true);
  });
});
