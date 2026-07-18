import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readConfigFileSnapshot, writeIncludeSectionFileAtomic } from "../config/io.js";
import type { ConfigFileSnapshot } from "../config/types.js";
import { isRecord } from "../utils.js";
import { resolveDoctorRepairMode } from "./doctor-repair-mode.js";
import type { DoctorOptions } from "./doctor.types.js";

export const SPLIT_CONFIG_DIRNAME = "config";

/**
 * Keys that stay in genesis.json after a split: restart-classified gateway
 * infra (see src/gateway/config-reload-plan.ts) plus root-file metadata.
 */
export const SPLIT_ROOT_ONLY_KEYS = new Set([
  "$schema",
  "meta",
  "gateway",
  "discovery",
  "canvasHost",
]);

export function collectSplittableTopLevelKeys(parsed: unknown): string[] {
  if (!isRecord(parsed)) {
    return [];
  }
  return Object.keys(parsed).filter((key) => {
    if (SPLIT_ROOT_ONLY_KEYS.has(key)) {
      return false;
    }
    const value = parsed[key];
    // Only object sections split cleanly into `{ "$include": ... }` markers;
    // sections already using $include (marker or merge overlay) are left as-is.
    return isRecord(value) && !Object.prototype.hasOwnProperty.call(value, "$include");
  });
}

export type ConfigSplitResult =
  | { status: "skipped"; reason: "missing" | "invalid" | "nothing-to-split" }
  | { status: "split"; keys: string[]; configDir: string }
  | { status: "failed"; error: string };

export async function applyConfigSplitMigration(
  baseSnapshot?: ConfigFileSnapshot,
): Promise<ConfigSplitResult> {
  const snapshot = baseSnapshot ?? (await readConfigFileSnapshot());
  if (!snapshot.exists) {
    return { status: "skipped", reason: "missing" };
  }
  if (!snapshot.valid || !isRecord(snapshot.parsed) || typeof snapshot.raw !== "string") {
    return { status: "skipped", reason: "invalid" };
  }
  const keys = collectSplittableTopLevelKeys(snapshot.parsed);
  if (keys.length === 0) {
    return { status: "skipped", reason: "nothing-to-split" };
  }

  const configDir = path.join(path.dirname(snapshot.path), SPLIT_CONFIG_DIRNAME);
  const previousRaw = snapshot.raw;
  const beforeResolved = structuredClone(snapshot.resolved);
  // Split the AUTHORED root, not the resolved config, so literal ${VAR}
  // references and nested $include directives move into section files verbatim.
  const nextParsed: Record<string, unknown> = { ...snapshot.parsed };
  try {
    await fs.promises.mkdir(configDir, { recursive: true, mode: 0o700 });
    for (const key of keys) {
      await writeIncludeSectionFileAtomic({
        filePath: path.join(configDir, `${key}.json`),
        value: nextParsed[key],
        fsModule: fs,
      });
      nextParsed[key] = { $include: `${SPLIT_CONFIG_DIRNAME}/${key}.json` };
    }
    // writeIncludeSectionFileAtomic rotates .bak backups for existing files.
    await writeIncludeSectionFileAtomic({
      filePath: snapshot.path,
      value: nextParsed,
      fsModule: fs,
    });

    const after = await readConfigFileSnapshot();
    if (!after.valid || !isDeepStrictEqual(after.resolved, beforeResolved)) {
      await fs.promises.writeFile(snapshot.path, previousRaw, {
        encoding: "utf-8",
        mode: 0o600,
      });
      return {
        status: "failed",
        error:
          "resolved config changed after splitting; restored the previous genesis.json (section files were left in place)",
      };
    }
    return { status: "split", keys, configDir };
  } catch (err) {
    await fs.promises
      .writeFile(snapshot.path, previousRaw, { encoding: "utf-8", mode: 0o600 })
      .catch(() => {
        // best-effort restore
      });
    return { status: "failed", error: String(err) };
  }
}

/**
 * Opt-in doctor step: offer to split a monolithic genesis.json into per-domain
 * `config/<section>.json` include files. Never auto-applies under --yes /
 * --fix / non-interactive runs unless `--split-config` was passed explicitly.
 */
export async function maybeSplitConfigLayout(params: {
  options: DoctorOptions;
  confirmSplit: (message: string) => Promise<boolean>;
  note: (message: string, title?: string) => void;
}): Promise<ConfigSplitResult | null> {
  const explicit = params.options.splitConfig === true;
  const mode = resolveDoctorRepairMode(params.options);
  if (!explicit && !mode.canPrompt) {
    return null;
  }
  const snapshot = await readConfigFileSnapshot();
  const keys = collectSplittableTopLevelKeys(snapshot.valid ? snapshot.parsed : null);
  if (!snapshot.exists || keys.length === 0) {
    if (explicit) {
      params.note("Nothing to split: config is already split or has no splittable sections.");
    }
    return null;
  }
  if (!explicit) {
    const approved = await params.confirmSplit(
      `Split genesis.json into ${SPLIT_CONFIG_DIRNAME}/<section>.json files? (${keys.length} sections: ${keys.join(", ")})`,
    );
    if (!approved) {
      return null;
    }
  }
  const result = await applyConfigSplitMigration(snapshot);
  if (result.status === "split") {
    params.note(
      result.keys.map((key) => `- ${key} -> ${SPLIT_CONFIG_DIRNAME}/${key}.json`).join("\n"),
      "Config split",
    );
  } else if (result.status === "failed") {
    params.note(`Config split failed: ${result.error}`, "Doctor warnings");
  }
  return result;
}
