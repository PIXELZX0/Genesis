export const PROJECT_NAME = "genesis" as const;

export const LEGACY_PROJECT_NAMES = ["clawdbot"] as const;

export const MANIFEST_KEY = PROJECT_NAME;

export const LEGACY_MANIFEST_KEYS = LEGACY_PROJECT_NAMES;

export const COMPATIBLE_MANIFEST_KEYS = [
  MANIFEST_KEY,
  "openclaw",
  ...LEGACY_MANIFEST_KEYS,
] as const;

export const LEGACY_PLUGIN_MANIFEST_FILENAMES = [] as const;

export const LEGACY_CANVAS_HANDLER_NAMES = [] as const;

export const MACOS_APP_SOURCES_DIR = "apps/macos/Sources/Genesis" as const;

export const LEGACY_MACOS_APP_SOURCES_DIRS = [] as const;
