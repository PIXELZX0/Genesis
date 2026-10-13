/** Reorderable system prompt sections, in default order. All sit above the prompt-cache boundary. */
export const SYSTEM_PROMPT_SECTION_IDS = [
  "tooling",
  "tool_usage",
  "mcp_instructions",
  "interaction_style",
  "tool_call_style",
  "execution_bias",
  "provider_prefix",
  "safety",
  "cli_reference",
  "skills",
  "memory",
  "self_update",
  "model_aliases",
  "workspace",
  "docs",
  "sandbox",
  "authorized_senders",
  "time",
  "workspace_files",
  "output_directives",
  "control_ui_embed",
  "messaging",
  "voice",
  "reactions",
  "reasoning_format",
  "project_context",
  "silent_replies",
] as const;

export type SystemPromptSectionId = (typeof SYSTEM_PROMPT_SECTION_IDS)[number];

/** A section id, or `*` for "every unlisted section, in default order". */
export type SystemPromptSectionOrderEntry = SystemPromptSectionId | "*";
