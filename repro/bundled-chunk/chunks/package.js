import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EVE_PACKAGE_NAME } from "./package-name.js";

let cachedPackageInfo;
const BUNDLED_FALLBACK_PACKAGE_VERSION = `0.44.3`;

function resolveFallbackPackageVersion() {
  return BUNDLED_FALLBACK_PACKAGE_VERSION.startsWith(`__`)
    ? `0.0.0`
    : BUNDLED_FALLBACK_PACKAGE_VERSION;
}

const FALLBACK_PACKAGE_INFO = {
  name: EVE_PACKAGE_NAME,
  version: resolveFallbackPackageVersion(),
};

function resolveCurrentModulePath() {
  return typeof __filename === `string`
    ? __filename
    : fileURLToPath(import.meta.url);
}

const require = createRequire(resolveCurrentModulePath());

function tryResolveVerifiedPackageRoot(packageJsonPath) {
  try {
    const resolved = realpathSync.native(packageJsonPath);
    return tryReadInstalledPackageInfo(resolved, EVE_PACKAGE_NAME) === undefined
      ? undefined
      : dirname(resolved);
  } catch {
    return;
  }
}

function findNearestVerifiedPackageRoot(startDir) {
  let current = startDir;
  for (;;) {
    const root = tryResolveVerifiedPackageRoot(join(current, `package.json`));
    if (root !== undefined) return root;
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function tryResolveDirectBuildLocation(modulePath) {
  let current = dirname(modulePath);
  for (;;) {
    if (basename(current) === `dist`) {
      const root = tryResolveVerifiedPackageRoot(
        join(dirname(current), `package.json`),
      );
      if (root !== undefined) {
        return { packageBuildRoot: current, packageRoot: root };
      }
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function isSourceCheckout(packageRoot) {
  return existsSync(
    join(packageRoot, `src`, `internal`, `application`, `package.ts`),
  );
}

function tryCreatePackageLocation(packageRoot) {
  if (isSourceCheckout(packageRoot)) {
    return { packageBuildRoot: null, packageRoot };
  }
  const dist = join(packageRoot, `dist`);
  if (existsSync(dist)) {
    return { packageBuildRoot: dist, packageRoot };
  }
}

function resolveSelfPackageJsonPath(fromModule) {
  return createRequire(fromModule).resolve(`${EVE_PACKAGE_NAME}/package.json`);
}

function resolvePackageLocationFromModulePath(
  modulePath,
  resolvePackageJson = resolveSelfPackageJsonPath,
) {
  const resolved = realpathSync.native(modulePath);
  const direct = tryResolveDirectBuildLocation(resolved);
  if (direct !== undefined) return direct;

  const nearest = findNearestVerifiedPackageRoot(dirname(resolved));
  if (nearest !== undefined && isSourceCheckout(nearest)) {
    return { packageBuildRoot: null, packageRoot: nearest };
  }

  try {
    const packageJsonPath = tryResolveVerifiedPackageRoot(
      resolvePackageJson(resolved),
    );
    const location =
      packageJsonPath === undefined
        ? undefined
        : tryCreatePackageLocation(packageJsonPath);
    if (location !== undefined) return location;
  } catch {}

  const fallback =
    nearest === undefined ? undefined : tryCreatePackageLocation(nearest);
  if (fallback !== undefined) return fallback;

  throw new Error(`Failed to resolve the eve package root from "${modulePath}".`);
}

function resolvePackageLocation() {
  return resolvePackageLocationFromModulePath(resolveCurrentModulePath());
}

function resolvePackageRoot() {
  return resolvePackageLocation().packageRoot;
}

function tryResolvePackageRoot() {
  try {
    return resolvePackageRoot();
  } catch {
    return;
  }
}

function normalizeInstalledPackageInfo(raw) {
  const parsed = raw;
  if (typeof parsed.name !== `string` || typeof parsed.version !== `string`) {
    return;
  }
  return { name: parsed.name, version: parsed.version };
}

function tryReadInstalledPackageInfo(packageJsonPath, expectedName) {
  const info = normalizeInstalledPackageInfo(
    JSON.parse(readFileSync(packageJsonPath, `utf8`)),
  );
  if (info?.name === expectedName) return info;
}

/** Mirrors eve/dist/src/internal/application/package.js resolveInstalledPackageInfo */
export function resolveInstalledPackageInfo() {
  if (cachedPackageInfo) return cachedPackageInfo;

  const root = tryResolvePackageRoot();
  const fromRoot =
    root === undefined
      ? undefined
      : tryReadInstalledPackageInfo(join(root, `package.json`), EVE_PACKAGE_NAME);
  if (fromRoot) {
    cachedPackageInfo = fromRoot;
    return cachedPackageInfo;
  }

  try {
    const fromResolve = tryReadInstalledPackageInfo(
      require.resolve(`${EVE_PACKAGE_NAME}/package.json`),
      EVE_PACKAGE_NAME,
    );
    if (fromResolve) {
      cachedPackageInfo = fromResolve;
      return cachedPackageInfo;
    }
  } catch {}

  cachedPackageInfo = { ...FALLBACK_PACKAGE_INFO };
  return cachedPackageInfo;
}
