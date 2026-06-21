import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { ModelProviderWizardStep } from "../app-model-providers.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  GatewayAgentRow,
  ModelCatalogEntry,
  SkillStatusReport,
  ToolsCatalogResult,
  ToolsEffectiveResult,
} from "../types.ts";
import { renderAgentOverview } from "./agents-panels-overview.ts";
import {
  renderAgentFiles,
  renderAgentChannels,
  renderAgentCron,
} from "./agents-panels-status-files.ts";
export type { AgentsPanel } from "./agents.types.ts";
import { renderAgentTools, renderAgentSkills } from "./agents-panels-tools-skills.ts";
import { buildAgentContext, normalizeAgentLabel } from "./agents-utils.ts";
import type { AgentsPanel } from "./agents.types.ts";

const AGENTS_GRID = "grid-template-columns: 1.6fr 1.2fr 0.8fr 1.4fr;";

function agentStat(value: string, label: string, last = false) {
  const border = last ? "" : "border-right: 1px solid var(--border);";
  return html`
    <div
      style="display: flex; flex-direction: column; gap: 4px; padding: 16px 20px; flex: 1; min-width: 0; ${border}"
    >
      <div
        style="font-family: var(--mono); font-size: 24px; font-weight: 600; line-height: 1.1; color: var(--text); overflow: hidden; text-overflow: ellipsis;"
      >
        ${value}
      </div>
      <div class="muted" style="font-size: 13px;">${label}</div>
    </div>
  `;
}

function renderAgentRow(
  agent: GatewayAgentRow,
  props: AgentsProps,
  defaultId: string | null,
  selectedId: string | null,
) {
  const isDefault = defaultId != null && agent.id === defaultId;
  const isSelected = selectedId === agent.id;
  const model = agent.model?.primary ?? "—";
  const fallbacks = agent.model?.fallbacks?.length ?? 0;
  const workspace = agent.workspace ?? "—";
  return html`
    <div
      class="table-row"
      style="cursor: pointer; ${isSelected ? "background: var(--bg-elevated);" : ""} ${AGENTS_GRID}"
      @click=${() => props.onSelectAgent(agent.id)}
    >
      <span style="color: var(--text); display: flex; align-items: center; gap: 8px;">
        <span class="status-dot ${isDefault ? "status-dot--ok" : "status-dot--idle"}"></span>
        ${normalizeAgentLabel(agent)}
        ${isDefault ? html`<span class="muted" style="font-size: 12px;">· default</span>` : nothing}
      </span>
      <span class="muted" style="font-family: var(--mono);">${model}</span>
      <span class="muted">${fallbacks > 0 ? fallbacks : "—"}</span>
      <span
        class="muted"
        style="font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
        >${workspace}</span
      >
    </div>
  `;
}

export type ConfigState = {
  form: Record<string, unknown> | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
};

export type ChannelsState = {
  snapshot: ChannelsStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  lastSuccess: number | null;
};

export type CronState = {
  status: CronStatus | null;
  jobs: CronJob[];
  loading: boolean;
  error: string | null;
};

export type AgentFilesState = {
  list: AgentsFilesListResult | null;
  loading: boolean;
  error: string | null;
  active: string | null;
  contents: Record<string, string>;
  drafts: Record<string, string>;
  saving: boolean;
};

export type AgentSkillsState = {
  report: SkillStatusReport | null;
  loading: boolean;
  error: string | null;
  agentId: string | null;
  filter: string;
};

export type ToolsCatalogState = {
  loading: boolean;
  error: string | null;
  result: ToolsCatalogResult | null;
};

export type ToolsEffectiveState = {
  loading: boolean;
  error: string | null;
  result: ToolsEffectiveResult | null;
};

export type AgentsProps = {
  basePath: string;
  connected: boolean;
  loading: boolean;
  error: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  activePanel: AgentsPanel;
  config: ConfigState;
  channels: ChannelsState;
  cron: CronState;
  agentFiles: AgentFilesState;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkills: AgentSkillsState;
  toolsCatalog: ToolsCatalogState;
  toolsEffective: ToolsEffectiveState;
  runtimeSessionKey: string;
  runtimeSessionMatchesSelectedAgent: boolean;
  modelCatalog: ModelCatalogEntry[];
  modelProviderWizardStep: ModelProviderWizardStep | null;
  modelProviderWizardInput: unknown;
  modelProviderWizardBusy: boolean;
  modelProviderWizardError: string | null;
  modelProviderWizardMessage: string | null;
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
  onToolsProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onToolsOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onModelProviderWizardStart: () => void;
  onModelProviderWizardSubmit: () => void;
  onModelProviderWizardCancel: () => void;
  onModelProviderWizardInput: (value: unknown) => void;
  onModelProviderWizardClose: () => void;
  onChannelsRefresh: () => void;
  onCronRefresh: () => void;
  onCronRunNow: (jobId: string) => void;
  onSkillsFilterChange: (next: string) => void;
  onSkillsRefresh: () => void;
  onAgentSkillToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onAgentSkillsClear: (agentId: string) => void;
  onAgentSkillsDisableAll: (agentId: string) => void;
  onSetDefault: (agentId: string) => void;
};

export function renderAgents(props: AgentsProps) {
  const agents = props.agentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const selectedId = props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? null;
  const selectedAgent = selectedId
    ? (agents.find((agent) => agent.id === selectedId) ?? null)
    : null;
  const selectedSkillCount =
    selectedId && props.agentSkills.agentId === selectedId
      ? (props.agentSkills.report?.skills?.length ?? null)
      : null;

  const channelEntryCount = props.channels.snapshot
    ? Object.keys(props.channels.snapshot.channelAccounts ?? {}).length
    : null;
  const cronJobCount = selectedId
    ? props.cron.jobs.filter((j) => j.agentId === selectedId).length
    : null;
  const tabCounts: Record<string, number | null> = {
    files: props.agentFiles.list?.files?.length ?? null,
    skills: selectedSkillCount,
    channels: channelEntryCount,
    cron: cronJobCount || null,
  };

  return html`
    <div class="agents-layout">
      <section>
        <div
          class="row"
          style="justify-content: space-between; align-items: flex-start; gap: 16px;"
        >
          <div>
            <div class="view-title">${t("tabs.agents")}</div>
            <div class="view-sub">${agents.length} ${agents.length === 1 ? "agent" : "agents"}</div>
          </div>
          <div class="row" style="gap: 8px; flex: none;">
            ${selectedAgent
              ? html`
                  <button
                    type="button"
                    class="btn"
                    @click=${() => void navigator.clipboard.writeText(selectedAgent.id)}
                    title="Copy agent ID to clipboard"
                  >
                    Copy ID
                  </button>
                  <button
                    type="button"
                    class="btn"
                    ?disabled=${Boolean(defaultId && selectedAgent.id === defaultId)}
                    @click=${() => props.onSetDefault(selectedAgent.id)}
                    title=${defaultId && selectedAgent.id === defaultId
                      ? "Already the default agent"
                      : "Set as the default agent"}
                  >
                    ${defaultId && selectedAgent.id === defaultId ? "Default" : "Set Default"}
                  </button>
                `
              : nothing}
            <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
              ${props.loading ? t("common.loading") : t("common.refresh")}
            </button>
          </div>
        </div>
        ${props.error
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
          : nothing}

        <div class="card" style="display: flex; padding: 0; margin-top: 24px; overflow: hidden;">
          ${agentStat(String(agents.length), "Agents")}
          ${agentStat(defaultId ?? t("common.na"), "Default")}
          ${agentStat(String(channelEntryCount ?? 0), "Channels")}
          ${agentStat(String(props.cron.jobs.length), "Cron jobs", true)}
        </div>

        ${agents.length === 0
          ? html`<div class="muted" style="padding: 16px;">
              ${props.loading ? t("common.loading") : t("common.na")}
            </div>`
          : html`
              <div class="table" style="margin-top: 24px;">
                <div class="table-head" style=${AGENTS_GRID}>
                  <span>AGENT</span>
                  <span>MODEL</span>
                  <span>FALLBACKS</span>
                  <span>WORKSPACE</span>
                </div>
                ${agents.map((agent) => renderAgentRow(agent, props, defaultId, selectedId))}
              </div>
            `}
      </section>
      <section class="agents-main">
        ${!selectedAgent
          ? nothing
          : html`
              ${renderAgentTabs(
                props.activePanel,
                (panel) => props.onSelectPanel(panel),
                tabCounts,
              )}
              ${props.activePanel === "overview"
                ? renderAgentOverview({
                    agent: selectedAgent,
                    basePath: props.basePath,
                    defaultId,
                    configForm: props.config.form,
                    agentFilesList: props.agentFiles.list,
                    agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                    agentIdentityError: props.agentIdentityError,
                    agentIdentityLoading: props.agentIdentityLoading,
                    configLoading: props.config.loading,
                    configSaving: props.config.saving,
                    configDirty: props.config.dirty,
                    connected: props.connected,
                    modelCatalog: props.modelCatalog,
                    modelProviderWizardStep: props.modelProviderWizardStep,
                    modelProviderWizardInput: props.modelProviderWizardInput,
                    modelProviderWizardBusy: props.modelProviderWizardBusy,
                    modelProviderWizardError: props.modelProviderWizardError,
                    modelProviderWizardMessage: props.modelProviderWizardMessage,
                    onConfigReload: props.onConfigReload,
                    onConfigSave: props.onConfigSave,
                    onModelChange: props.onModelChange,
                    onModelFallbacksChange: props.onModelFallbacksChange,
                    onModelProviderWizardStart: props.onModelProviderWizardStart,
                    onModelProviderWizardSubmit: props.onModelProviderWizardSubmit,
                    onModelProviderWizardCancel: props.onModelProviderWizardCancel,
                    onModelProviderWizardInput: props.onModelProviderWizardInput,
                    onModelProviderWizardClose: props.onModelProviderWizardClose,
                    onSelectPanel: props.onSelectPanel,
                  })
                : nothing}
              ${props.activePanel === "files"
                ? renderAgentFiles({
                    agentId: selectedAgent.id,
                    agentFilesList: props.agentFiles.list,
                    agentFilesLoading: props.agentFiles.loading,
                    agentFilesError: props.agentFiles.error,
                    agentFileActive: props.agentFiles.active,
                    agentFileContents: props.agentFiles.contents,
                    agentFileDrafts: props.agentFiles.drafts,
                    agentFileSaving: props.agentFiles.saving,
                    onLoadFiles: props.onLoadFiles,
                    onSelectFile: props.onSelectFile,
                    onFileDraftChange: props.onFileDraftChange,
                    onFileReset: props.onFileReset,
                    onFileSave: props.onFileSave,
                  })
                : nothing}
              ${props.activePanel === "tools"
                ? renderAgentTools({
                    agentId: selectedAgent.id,
                    configForm: props.config.form,
                    configLoading: props.config.loading,
                    configSaving: props.config.saving,
                    configDirty: props.config.dirty,
                    toolsCatalogLoading: props.toolsCatalog.loading,
                    toolsCatalogError: props.toolsCatalog.error,
                    toolsCatalogResult: props.toolsCatalog.result,
                    toolsEffectiveLoading: props.toolsEffective.loading,
                    toolsEffectiveError: props.toolsEffective.error,
                    toolsEffectiveResult: props.toolsEffective.result,
                    runtimeSessionKey: props.runtimeSessionKey,
                    runtimeSessionMatchesSelectedAgent: props.runtimeSessionMatchesSelectedAgent,
                    onProfileChange: props.onToolsProfileChange,
                    onOverridesChange: props.onToolsOverridesChange,
                    onConfigReload: props.onConfigReload,
                    onConfigSave: props.onConfigSave,
                  })
                : nothing}
              ${props.activePanel === "skills"
                ? renderAgentSkills({
                    agentId: selectedAgent.id,
                    report: props.agentSkills.report,
                    loading: props.agentSkills.loading,
                    error: props.agentSkills.error,
                    activeAgentId: props.agentSkills.agentId,
                    configForm: props.config.form,
                    configLoading: props.config.loading,
                    configSaving: props.config.saving,
                    configDirty: props.config.dirty,
                    filter: props.agentSkills.filter,
                    onFilterChange: props.onSkillsFilterChange,
                    onRefresh: props.onSkillsRefresh,
                    onToggle: props.onAgentSkillToggle,
                    onClear: props.onAgentSkillsClear,
                    onDisableAll: props.onAgentSkillsDisableAll,
                    onConfigReload: props.onConfigReload,
                    onConfigSave: props.onConfigSave,
                  })
                : nothing}
              ${props.activePanel === "channels"
                ? renderAgentChannels({
                    context: buildAgentContext(
                      selectedAgent,
                      props.config.form,
                      props.agentFiles.list,
                      defaultId,
                      props.agentIdentityById[selectedAgent.id] ?? null,
                    ),
                    configForm: props.config.form,
                    snapshot: props.channels.snapshot,
                    loading: props.channels.loading,
                    error: props.channels.error,
                    lastSuccess: props.channels.lastSuccess,
                    onRefresh: props.onChannelsRefresh,
                    onSelectPanel: props.onSelectPanel,
                  })
                : nothing}
              ${props.activePanel === "cron"
                ? renderAgentCron({
                    context: buildAgentContext(
                      selectedAgent,
                      props.config.form,
                      props.agentFiles.list,
                      defaultId,
                      props.agentIdentityById[selectedAgent.id] ?? null,
                    ),
                    agentId: selectedAgent.id,
                    jobs: props.cron.jobs,
                    status: props.cron.status,
                    loading: props.cron.loading,
                    error: props.cron.error,
                    onRefresh: props.onCronRefresh,
                    onRunNow: props.onCronRunNow,
                    onSelectPanel: props.onSelectPanel,
                  })
                : nothing}
            `}
      </section>
    </div>
  `;
}

function renderAgentTabs(
  active: AgentsPanel,
  onSelect: (panel: AgentsPanel) => void,
  counts: Record<string, number | null>,
) {
  const tabs: Array<{ id: AgentsPanel; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "files", label: "Files" },
    { id: "tools", label: "Tools" },
    { id: "skills", label: "Skills" },
    { id: "channels", label: "Channels" },
    { id: "cron", label: "Cron Jobs" },
  ];
  return html`
    <div class="agent-tabs">
      ${tabs.map(
        (tab) => html`
          <button
            class="agent-tab ${active === tab.id ? "active" : ""}"
            type="button"
            @click=${() => onSelect(tab.id)}
          >
            ${tab.label}${counts[tab.id] != null
              ? html`<span class="agent-tab-count">${counts[tab.id]}</span>`
              : nothing}
          </button>
        `,
      )}
    </div>
  `;
}
