/**
 * Config presets — opinionated configuration bundles that set multiple
 * settings at once. Applied via config.patch.
 */

export type ConfigPresetId = "personal" | "codeAgent" | "teamBot" | "minimal";

export type ConfigPreset = {
  id: ConfigPresetId;
  label: string;
  description: string;
  icon: string;
  patch: Record<string, unknown>;
};

export const CONFIG_PRESETS: ConfigPreset[] = [
  {
    id: "personal",
    label: "Personal Assistant",
    description: "Balanced context and cost. Best for daily use.",
    icon: "✨",
    patch: {
      agents: {
        defaults: {
          bootstrapMaxChars: 20_000,
          bootstrapTotalMaxChars: 150_000,
          contextInjection: "always",
        },
      },
    },
  },
  {
    id: "codeAgent",
    label: "Code Agent",
    description: "Higher context for coding tasks. More tokens per turn.",
    icon: "🛠️",
    patch: {
      agents: {
        defaults: {
          bootstrapMaxChars: 50_000,
          bootstrapTotalMaxChars: 300_000,
          contextInjection: "always",
        },
      },
    },
  },
  {
    id: "teamBot",
    label: "Team Bot",
    description: "Multi-channel, group-aware. Leaner per-turn context.",
    icon: "👥",
    patch: {
      agents: {
        defaults: {
          bootstrapMaxChars: 10_000,
          bootstrapTotalMaxChars: 80_000,
          contextInjection: "continuation-skip",
        },
      },
    },
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Lowest cost per turn. Fast and lean.",
    icon: "⚡",
    patch: {
      agents: {
        defaults: {
          bootstrapMaxChars: 5_000,
          bootstrapTotalMaxChars: 30_000,
          contextInjection: "continuation-skip",
        },
      },
    },
  },
];

export function getPresetById(id: ConfigPresetId): ConfigPreset | undefined {
  return CONFIG_PRESETS.find((p) => p.id === id);
}

// Runtime fallbacks when agents.defaults leaves these unset
// (src/agents/pi-embedded-helpers/bootstrap.ts, src/agents/bootstrap-files.ts).
const RUNTIME_PRESET_DEFAULTS = {
  bootstrapMaxChars: 12_000,
  bootstrapTotalMaxChars: 60_000,
  contextInjection: "always",
} as const;

/**
 * Detect which preset (if any) matches the effective config values.
 * Returns null for built-in defaults or hand-tuned values.
 */
export function detectActivePreset(config: Record<string, unknown>): ConfigPresetId | null {
  const agents = config.agents as Record<string, unknown> | undefined;
  const defaults = (agents?.defaults ?? {}) as Record<string, unknown>;
  const effective = {
    bootstrapMaxChars: defaults.bootstrapMaxChars ?? RUNTIME_PRESET_DEFAULTS.bootstrapMaxChars,
    bootstrapTotalMaxChars:
      defaults.bootstrapTotalMaxChars ?? RUNTIME_PRESET_DEFAULTS.bootstrapTotalMaxChars,
    contextInjection: defaults.contextInjection ?? RUNTIME_PRESET_DEFAULTS.contextInjection,
  };
  for (const preset of CONFIG_PRESETS) {
    const presetDefaults = (preset.patch.agents as Record<string, unknown>)?.defaults as
      | Record<string, unknown>
      | undefined;
    if (
      presetDefaults &&
      effective.bootstrapMaxChars === presetDefaults.bootstrapMaxChars &&
      effective.bootstrapTotalMaxChars === presetDefaults.bootstrapTotalMaxChars &&
      effective.contextInjection === presetDefaults.contextInjection
    ) {
      return preset.id;
    }
  }
  return null;
}
