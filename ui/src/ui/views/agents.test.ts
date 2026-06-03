import { render } from "lit";
import { describe, expect, it } from "vitest";
import { withoutArrayCopyMethods } from "../test-helpers/array-copy-methods.ts";
import { renderAgents, type AgentsProps } from "./agents.ts";

function createSkill() {
  return {
    name: "Repo Skill",
    description: "Skill description",
    source: "workspace",
    filePath: "/tmp/skill",
    baseDir: "/tmp",
    skillKey: "repo-skill",
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    missing: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    configChecks: [],
    install: [],
  };
}

function createProps(overrides: Partial<AgentsProps> = {}): AgentsProps {
  return {
    basePath: "",
    connected: true,
    loading: false,
    error: null,
    agentsList: {
      defaultId: "alpha",
      mainKey: "main",
      scope: "workspace",
      agents: [{ id: "alpha", name: "Alpha" } as never, { id: "beta", name: "Beta" } as never],
    },
    selectedAgentId: "beta",
    activePanel: "overview",
    config: {
      form: null,
      loading: false,
      saving: false,
      dirty: false,
    },
    channels: {
      snapshot: null,
      loading: false,
      error: null,
      lastSuccess: null,
    },
    cron: {
      status: null,
      jobs: [],
      loading: false,
      error: null,
    },
    agentFiles: {
      list: null,
      loading: false,
      error: null,
      active: null,
      contents: {},
      drafts: {},
      saving: false,
    },
    agentIdentityLoading: false,
    agentIdentityError: null,
    agentIdentityById: {},
    agentSkills: {
      report: null,
      loading: false,
      error: null,
      agentId: null,
      filter: "",
    },
    toolsCatalog: {
      loading: false,
      error: null,
      result: null,
    },
    toolsEffective: {
      loading: false,
      error: null,
      result: null,
    },
    runtimeSessionKey: "main",
    runtimeSessionMatchesSelectedAgent: false,
    modelCatalog: [],
    modelProviderWizardStep: null,
    modelProviderWizardInput: null,
    modelProviderWizardBusy: false,
    modelProviderWizardError: null,
    modelProviderWizardMessage: null,
    onRefresh: () => undefined,
    onSelectAgent: () => undefined,
    onSelectPanel: () => undefined,
    onLoadFiles: () => undefined,
    onSelectFile: () => undefined,
    onFileDraftChange: () => undefined,
    onFileReset: () => undefined,
    onFileSave: () => undefined,
    onToolsProfileChange: () => undefined,
    onToolsOverridesChange: () => undefined,
    onConfigReload: () => undefined,
    onConfigSave: () => undefined,
    onModelChange: () => undefined,
    onModelFallbacksChange: () => undefined,
    onModelProviderWizardStart: () => undefined,
    onModelProviderWizardSubmit: () => undefined,
    onModelProviderWizardCancel: () => undefined,
    onModelProviderWizardInput: () => undefined,
    onModelProviderWizardClose: () => undefined,
    onChannelsRefresh: () => undefined,
    onCronRefresh: () => undefined,
    onCronRunNow: () => undefined,
    onSkillsFilterChange: () => undefined,
    onSkillsRefresh: () => undefined,
    onAgentSkillToggle: () => undefined,
    onAgentSkillsClear: () => undefined,
    onAgentSkillsDisableAll: () => undefined,
    onSetDefault: () => undefined,
    ...overrides,
  };
}

describe("renderAgents", () => {
  it("renders the tools panel when browser array copy methods are unavailable", async () => {
    const container = document.createElement("div");

    withoutArrayCopyMethods(() =>
      render(
        renderAgents(
          createProps({
            activePanel: "tools",
            toolsCatalog: {
              loading: false,
              error: null,
              result: {
                agentId: "beta",
                profiles: [],
                groups: [
                  {
                    id: "core",
                    label: "Core",
                    source: "core",
                    tools: [
                      {
                        id: "write",
                        label: "write",
                        description: "Write files",
                        source: "core",
                        defaultProfiles: [],
                      },
                      {
                        id: "read",
                        label: "read",
                        description: "Read files",
                        source: "core",
                        defaultProfiles: [],
                      },
                    ],
                  },
                ],
              },
            },
          }),
        ),
        container,
      ),
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Tool Access");
    expect(container.textContent).toContain("read");
  });

  it("shows the skills count only for the selected agent's report", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          agentSkills: {
            report: {
              workspaceDir: "/tmp/workspace",
              managedSkillsDir: "/tmp/skills",
              skills: [createSkill()],
            },
            loading: false,
            error: null,
            agentId: "alpha",
            filter: "",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    let skillsTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".agent-tab")).find(
      (button) => button.textContent?.includes("Skills"),
    );

    expect(skillsTab?.textContent?.trim()).toBe("Skills");

    render(
      renderAgents(
        createProps({
          agentSkills: {
            report: {
              workspaceDir: "/tmp/workspace",
              managedSkillsDir: "/tmp/skills",
              skills: [createSkill()],
            },
            loading: false,
            error: null,
            agentId: "beta",
            filter: "",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    skillsTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".agent-tab")).find(
      (button) => button.textContent?.includes("Skills"),
    );

    expect(skillsTab?.textContent?.trim()).toContain("1");
  });

  it("renders sensitive model provider wizard prompts as password inputs", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          modelProviderWizardStep: {
            id: "step-1",
            type: "text",
            message: "Enter OpenAI API key",
            sensitive: true,
          },
          modelProviderWizardInput: "",
        }),
      ),
      container,
    );
    await Promise.resolve();

    const input = container.querySelector<HTMLInputElement>(".channel-wizard-text");
    expect(input?.type).toBe("password");
  });
});
