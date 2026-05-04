import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const WORKFLOW_DIR = ".github/workflows";
const WORKFLOW_PATH = `${WORKFLOW_DIR}/ci-check-testbox.yml`;

type WorkflowStep = {
  run?: string;
  uses?: string;
};

type WorkflowJob = {
  "runs-on"?: string | string[];
  steps?: WorkflowStep[];
};

type WorkflowDocument = {
  jobs?: Record<string, WorkflowJob>;
  name?: string;
  on?: {
    workflow_dispatch?: {
      inputs?: Record<string, { description?: string; required?: boolean; type?: string }>;
    };
  };
};

describe("Blacksmith Testbox workflow", () => {
  it("hydrates a Blacksmith runner and waits for remote test commands", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const parsed = parse(workflow) as WorkflowDocument;

    expect(parsed.name).toBe("Blacksmith Testbox");
    expect(parsed.on?.workflow_dispatch?.inputs?.testbox_id).toEqual({
      description: "Testbox session ID",
      required: true,
      type: "string",
    });

    const job = parsed.jobs?.test;
    expect(job).toBeDefined();
    if (!job) {
      throw new Error("Missing Testbox job");
    }

    expect(job["runs-on"]).toBe("blacksmith-32vcpu-ubuntu-2404");
    const uses = (job.steps ?? []).flatMap((step) =>
      step.uses ? [step.uses] : [],
    );
    expect(uses).toContain("useblacksmith/begin-testbox@v2");
    expect(uses).toContain("useblacksmith/run-testbox@v2");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).not.toContain("pnpm test");
    expect(workflow).not.toContain("pnpm check");
  });
});

describe("GitHub workflows", () => {
  it("runs every non-publishing job on Blacksmith runners", () => {
    const githubHostedRunnerExceptions = new Set([
      "genesis-npm-release.yml:publish:ubuntu-24.04",
    ]);
    const workflowFiles = readdirSync(WORKFLOW_DIR)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .toSorted((a, b) => a.localeCompare(b));

    const nonBlacksmithJobs: string[] = [];
    for (const file of workflowFiles) {
      const parsed = parse(readFileSync(`${WORKFLOW_DIR}/${file}`, "utf8")) as WorkflowDocument;
      for (const [jobName, job] of Object.entries(parsed.jobs ?? {})) {
        const runsOn = job["runs-on"];
        if (!runsOn) {
          continue;
        }
        const labels = Array.isArray(runsOn) ? runsOn : [runsOn];
        const jobKey = `${file}:${jobName}:${labels.join(",")}`;
        if (githubHostedRunnerExceptions.has(jobKey)) {
          continue;
        }
        if (!labels.some((label) => label.startsWith("blacksmith-"))) {
          nonBlacksmithJobs.push(jobKey);
        }
      }
    }

    expect(nonBlacksmithJobs).toEqual([]);
  });
});
