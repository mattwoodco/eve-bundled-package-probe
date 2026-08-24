/**
 * Simulates workflow-runtime module init in a bundled Vercel .func directory.
 * Eve calls resolveInstalledPackageInfo() at top level before /eve/v1/health runs.
 */
import { resolveInstalledPackageInfo } from "./chunks/package.js";

const info = resolveInstalledPackageInfo();
console.log(JSON.stringify({ ok: true, packageInfo: info }));
