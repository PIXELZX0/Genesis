import type { SkillWorkshopConfig } from "./config.js";

export function buildWorkshopGuidance(config: SkillWorkshopConfig): string {
  const writeMode =
    config.approvalPolicy === "auto"
      ? "Auto mode: apply safe workspace-skill updates when clearly reusable."
      : "Pending mode: queue suggestions; apply only after explicit approval.";
  return [
    "<skill_workshop>",
    "Use for durable procedural memory, not facts/preferences.",
    "Capture repeatable workflows, user corrections, non-obvious successful procedures, recurring pitfalls, and task-specific user preferences.",
    "Preference order: update a loaded/consulted skill, update an existing class-level umbrella, add a support file under an umbrella, then create a new class-level skill.",
    "Support files are for concise reusable detail: references/ for evidence or provider quirks, templates/ for reusable starters, scripts/ for deterministic checks.",
    "Do not create one-session-one-skill entries named after PR numbers, error strings, feature codenames, or today's artifact.",
    "Do not capture missing binaries, unconfigured credentials, or transient setup failures as permanent tool limitations; capture the durable fix pattern instead.",
    "After long tool loops or hard fixes, save the reusable procedure.",
    "Keep skill text short, imperative, tool-aware. No transcript dumps, secrets, or hidden prompt refs.",
    writeMode,
    "</skill_workshop>",
  ].join("\n");
}
