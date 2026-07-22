#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PI_DEPENDENCY_SCOPE = "@earendil-works/";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const SKIP_ENV_VAR = "GENESIS_SKIP_PI_LATEST_CHECK";
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/u;

export function collectPinnedPiDependencies(packageJson) {
  const pinned = [];
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, spec] of Object.entries(packageJson?.[section] ?? {})) {
      if (!name.startsWith(PI_DEPENDENCY_SCOPE) || !EXACT_VERSION_PATTERN.test(spec)) {
        continue;
      }
      pinned.push({ name, section, spec });
    }
  }
  return pinned.toSorted((left, right) => left.name.localeCompare(right.name));
}

function resolveRegistryBaseUrl() {
  const configured =
    process.env.npm_config_registry ?? process.env.NPM_CONFIG_REGISTRY ?? DEFAULT_REGISTRY;
  return configured.replace(/\/+$/u, "");
}

export async function fetchLatestVersion({
  name,
  fetchImpl = fetch,
  registryBaseUrl = resolveRegistryBaseUrl(),
}) {
  const response = await fetchImpl(`${registryBaseUrl}/${name}/latest`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `registry lookup for '${name}' failed (${response.status} ${response.statusText})`,
    );
  }
  const manifest = await response.json();
  if (typeof manifest?.version !== "string" || manifest.version.length === 0) {
    throw new Error(`registry lookup for '${name}' returned no version`);
  }
  return manifest.version;
}

export async function collectPiLatestDriftErrors({
  pinned,
  fetchImpl = fetch,
  registryBaseUrl = resolveRegistryBaseUrl(),
}) {
  const latestVersions = await Promise.all(
    pinned.map((dependency) =>
      fetchLatestVersion({ name: dependency.name, fetchImpl, registryBaseUrl }),
    ),
  );
  return pinned
    .map((dependency, index) => ({ dependency, latest: latestVersions[index] }))
    .filter(({ dependency, latest }) => dependency.spec !== latest)
    .map(
      ({ dependency, latest }) =>
        `${dependency.name} is pinned to ${dependency.spec} in ${dependency.section} but npm latest is ${latest}`,
    );
}

async function main() {
  if (process.env[SKIP_ENV_VAR] === "1") {
    console.error(`[pi-latest] skipped via ${SKIP_ENV_VAR}=1`);
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const pinned = collectPinnedPiDependencies(packageJson);
  if (pinned.length === 0) {
    console.error(`[pi-latest] no exact-pinned ${PI_DEPENDENCY_SCOPE}* dependencies found`);
    return;
  }

  let errors;
  try {
    errors = await collectPiLatestDriftErrors({ pinned });
  } catch (error) {
    console.error(`[pi-latest] ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[pi-latest] set ${SKIP_ENV_VAR}=1 to bypass when the registry is unreachable`);
    process.exitCode = 1;
    return;
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[pi-latest] ${error}`);
    }
    console.error(
      "[pi-latest] merge the pending Dependabot 'pi' pull request, or bump the pins and run 'pnpm install'",
    );
    process.exitCode = 1;
    return;
  }

  console.error(`[pi-latest] ok (${pinned.length} pinned, all at npm latest)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
