export type ComparableSemver = {
  major: number;
  minor: number;
  patch: number;
  revision: number | null;
  prerelease: string[] | null;
};

export function normalizeLegacyDotBetaVersion(version: string): string {
  const trimmed = version.trim();
  const dotBetaMatch = /^([vV]?[0-9]+\.[0-9]+\.[0-9]+)\.beta(?:\.([0-9A-Za-z.-]+))?$/.exec(trimmed);
  if (!dotBetaMatch) {
    return trimmed;
  }
  const base = dotBetaMatch[1];
  const suffix = dotBetaMatch[2];
  return suffix ? `${base}-beta.${suffix}` : `${base}-beta`;
}

export function parseComparableSemver(
  version: string | null | undefined,
  options?: { normalizeLegacyDotBeta?: boolean },
): ComparableSemver | null {
  if (!version) {
    return null;
  }
  const normalized = options?.normalizeLegacyDotBeta
    ? normalizeLegacyDotBetaVersion(version)
    : version.trim();
  const match = /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    normalized,
  );
  if (!match) {
    return null;
  }
  const [, major, minor, patch, prereleaseRaw] = match;
  if (!major || !minor || !patch) {
    return null;
  }
  const revision =
    prereleaseRaw && /^[0-9]+$/.test(prereleaseRaw) ? Number.parseInt(prereleaseRaw, 10) : null;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    revision,
    prerelease: prereleaseRaw && revision == null ? prereleaseRaw.split(".").filter(Boolean) : null,
  };
}

export function comparePrereleaseIdentifiers(a: string[] | null, b: string[] | null): number {
  if (!a?.length && !b?.length) {
    return 0;
  }
  if (!a?.length) {
    return 1;
  }
  if (!b?.length) {
    return -1;
  }

  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (ai == null && bi == null) {
      return 0;
    }
    if (ai == null) {
      return -1;
    }
    if (bi == null) {
      return 1;
    }
    if (ai === bi) {
      continue;
    }

    const aiNumeric = /^[0-9]+$/.test(ai);
    const biNumeric = /^[0-9]+$/.test(bi);
    if (aiNumeric && biNumeric) {
      const aiNum = Number.parseInt(ai, 10);
      const biNum = Number.parseInt(bi, 10);
      return aiNum < biNum ? -1 : 1;
    }
    if (aiNumeric && !biNumeric) {
      return -1;
    }
    if (!aiNumeric && biNumeric) {
      return 1;
    }
    return ai < bi ? -1 : 1;
  }

  return 0;
}

export function compareComparableSemver(
  a: ComparableSemver | null,
  b: ComparableSemver | null,
): number | null {
  if (!a || !b) {
    return null;
  }
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1;
  }
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1;
  }
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1;
  }

  const rankA = releaseRank(a);
  const rankB = releaseRank(b);
  if (rankA !== rankB) {
    return rankA < rankB ? -1 : 1;
  }

  if (a.revision != null && b.revision != null && a.revision !== b.revision) {
    return a.revision < b.revision ? -1 : 1;
  }

  return comparePrereleaseIdentifiers(a.prerelease, b.prerelease);
}

function releaseRank(version: ComparableSemver): number {
  if (version.prerelease?.length) {
    return 0;
  }
  if (version.revision != null) {
    return 2;
  }
  return 1;
}
