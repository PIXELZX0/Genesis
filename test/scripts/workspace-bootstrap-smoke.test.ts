import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInstalledWorkspaceBootstrapSmoke } from "../../scripts/lib/workspace-bootstrap-smoke.mjs";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-workspace-bootstrap-smoke-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("runInstalledWorkspaceBootstrapSmoke", () => {
  it("uses setup so smoke verification avoids agent runtime loading", () => {
    const packageRoot = makeTempDir();
    fs.writeFileSync(
      path.join(packageRoot, "genesis.mjs"),
      `
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(path.join(packageRoot, "argv.json"), JSON.stringify(process.argv.slice(2)));

const workspaceDir = path.join(process.env.GENESIS_HOME, ".genesis", "workspace");
fs.mkdirSync(workspaceDir, { recursive: true });
for (const name of ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md"]) {
  fs.writeFileSync(path.join(workspaceDir, name), name);
}
`,
    );

    runInstalledWorkspaceBootstrapSmoke({ packageRoot });

    const argv = JSON.parse(fs.readFileSync(path.join(packageRoot, "argv.json"), "utf8"));
    expect(argv).toEqual(["setup"]);
  });
});
