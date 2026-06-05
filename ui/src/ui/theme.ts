export type ThemeName = "mono";
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "dark" | "light";

export const VALID_THEME_NAMES = new Set<ThemeName>(["mono"]);
export const VALID_THEME_MODES = new Set<ThemeMode>(["system", "light", "dark"]);

// Legacy persisted theme names (pre-monochrome palettes). Every palette now
// collapses to the single "mono" theme; we only preserve the user's light/dark
// preference so existing installs keep their mode after the redesign.
const LEGACY_MODE_MAP: Record<string, ThemeMode> = {
  defaultTheme: "dark",
  docsTheme: "light",
  lightTheme: "dark",
  landingTheme: "dark",
  newTheme: "dark",
  dark: "dark",
  light: "light",
  openknot: "dark",
  fieldmanual: "dark",
  clawdash: "light",
  claw: "dark",
  knot: "dark",
  dash: "dark",
  custom: "dark",
  system: "system",
};

export function prefersLightScheme(): boolean {
  if (typeof globalThis.matchMedia !== "function") {
    return false;
  }
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches;
}

export function resolveSystemTheme(): ResolvedTheme {
  return prefersLightScheme() ? "light" : "dark";
}

export function parseThemeSelection(
  themeRaw: unknown,
  modeRaw: unknown,
): { theme: ThemeName; mode: ThemeMode } {
  const themeStr = typeof themeRaw === "string" ? themeRaw : "";
  const modeStr = typeof modeRaw === "string" ? modeRaw : "";

  const mode = VALID_THEME_MODES.has(modeStr as ThemeMode)
    ? (modeStr as ThemeMode)
    : (LEGACY_MODE_MAP[themeStr] ?? "system");

  return { theme: "mono", mode };
}

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return prefersLightScheme() ? "light" : "dark";
  }
  return mode;
}

export function resolveTheme(_theme: ThemeName, mode: ThemeMode): ResolvedTheme {
  return resolveMode(mode);
}
