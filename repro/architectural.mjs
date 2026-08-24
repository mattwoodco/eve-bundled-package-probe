#!/usr/bin/env node
/**
 * Architectural reproduction: bundled serverless layout without node_modules/eve.
 *
 * Copies repro/bundled-chunk into a fresh temp directory (no eve install),
 * optionally makes it read-only to mimic Vercel function roots, then runs the
 * same resolveInstalledPackageInfo probe Eve executes at workflow-runtime init.
 */
import { cpSync, mkdtempSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundledChunkSource = join(repoRoot, "repro/bundled-chunk");
const readOnly = process.argv.includes("--read-only");

function run(runtime, cwd) {
  const label = readOnly ? `${runtime} (read-only cwd)` : runtime;
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(runtime, ["run.mjs"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      // Ensure no project node_modules is on the module search path.
      NODE_PATH: "",
    },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log(`exit code: ${result.status ?? "signal"}`);
  return result.status ?? 1;
}

const isolatedRoot = mkdtempSync(join(tmpdir(), "eve-bundled-func-"));
cpSync(bundledChunkSource, isolatedRoot, { recursive: true });
mkdirSync(join(isolatedRoot, "node_modules"), { recursive: true });

console.log(`Isolated function root: ${isolatedRoot}`);
console.log(
  "Layout: bundled chunk only — no resolvable eve/package.json (matches Nitro .func output).",
);

if (readOnly) {
  chmodSync(isolatedRoot, 0o555);
  chmodSync(join(isolatedRoot, "chunks"), 0o555);
  chmodSync(join(isolatedRoot, "node_modules"), 0o555);
}

const nodeStatus = run("node", isolatedRoot);

let bunStatus = 0;
if (spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0) {
  bunStatus = run("bun", isolatedRoot);
} else {
  console.log("\n=== Bun ===");
  console.log("skipped (bun not installed)");
}

if (readOnly) {
  chmodSync(isolatedRoot, 0o755);
  chmodSync(join(isolatedRoot, "chunks"), 0o755);
  chmodSync(join(isolatedRoot, "node_modules"), 0o755);
}
rmSync(isolatedRoot, { recursive: true, force: true });

console.log("\n--- Summary ---");
console.log(
  "Node: require.resolve('eve/package.json') throws MODULE_NOT_FOUND; Eve catches and uses stamped fallback.",
);
console.log(
  "Bun 1.4: default install.auto may attempt PackageManager mkdir under read-only function root → ReadOnlyFileSystem.",
);

process.exit(nodeStatus === 0 && bunStatus === 0 ? 0 : 1);
