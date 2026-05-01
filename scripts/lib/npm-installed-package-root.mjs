import path from "node:path";

/**
 * @param {string} packageName
 * @returns {string[]}
 */
export function packageNameToInstallPathSegments(packageName) {
  const trimmed = packageName.trim();
  if (!trimmed) {
    throw new Error("npm package name must be a non-empty string.");
  }

  const segments = trimmed.split("/");
  if (trimmed.startsWith("@")) {
    if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
      throw new Error(`scoped npm package name is invalid: ${packageName}`);
    }
    return segments;
  }

  if (segments.length !== 1 || segments[0].length === 0) {
    throw new Error(`npm package name is invalid: ${packageName}`);
  }
  return segments;
}

/**
 * @param {string} globalRoot
 * @param {string} packageName
 * @returns {string}
 */
export function resolveInstalledPackageRoot(globalRoot, packageName) {
  return path.join(globalRoot, ...packageNameToInstallPathSegments(packageName));
}

/**
 * @param {string} packageRoot
 * @param {string} packageName
 * @returns {boolean}
 */
export function packageRootLooksInstalled(packageRoot, packageName) {
  const normalizedRoot = packageRoot.replaceAll("\\", "/").replace(/\/+$/u, "");
  const installedSuffix = `/node_modules/${packageNameToInstallPathSegments(packageName).join("/")}`;
  return normalizedRoot.endsWith(installedSuffix);
}
