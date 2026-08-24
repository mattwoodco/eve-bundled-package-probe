#!/usr/bin/env node
/**
 * Raw require.resolve probe — the exact call Eve makes when bundled output has no
 * installed eve package. Node throws MODULE_NOT_FOUND (catchable). Bun 1.4 with
 * default install.auto may invoke PackageManager and crash on read-only FS.
 */
import { createRequire } from "node:module";
import { chmodSync, cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readOnly = process.argv.includes("--read-only");

const isolatedRoot = mkdtempSync(join(tmpdir(), "eve-resolve-probe-"));
cpSync(join(repoRoot, "repro/bundled-chunk/chunks"), join(isolatedRoot, "chunks"), {
  recursive: true,
});
mkdirSync(join(isolatedRoot, "node_modules"), { recursive: true });

const bundledModule = join(isolatedRoot, "chunks", "package.js");

if (readOnly) {
  chmodSync(isolatedRoot, 0o555);
  chmodSync(join(isolatedRoot, "chunks"), 0o555);
  chmodSync(join(isolatedRoot, "node_modules"), 0o555);
}

function probeWith(runtime) {
  const script = `
    import { createRequire } from 'node:module';
    const req = createRequire(${JSON.stringify(bundledModule)});
    try {
      console.log(JSON.stringify({ result: req.resolve('eve/package.json') }));
    } catch (error) {
      console.log(JSON.stringify({ caught: error.code ?? error.message }));
    }
  `;
  return spawnSync(runtime, ["-e", script], {
    cwd: isolatedRoot,
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: "" },
  });
}

console.log(`Isolated function root: ${isolatedRoot}`);
console.log(`Bundled module: ${bundledModule}`);
console.log(`read-only: ${readOnly}`);

console.log("\n=== node (raw require.resolve) ===");
const nodeResult = probeWith("node");
process.stdout.write(nodeResult.stdout ?? "");
process.stderr.write(nodeResult.stderr ?? "");
console.log(`exit: ${nodeResult.status}`);

console.log("\n=== bun (raw require.resolve) ===");
const bunResult = probeWith("bun");
process.stdout.write(bunResult.stdout ?? "");
process.stderr.write(bunResult.stderr ?? "");
console.log(`exit: ${bunResult.status}`);

if (readOnly) {
  chmodSync(isolatedRoot, 0o755);
  chmodSync(join(isolatedRoot, "chunks"), 0o755);
  chmodSync(join(isolatedRoot, "node_modules"), 0o755);
}
rmSync(isolatedRoot, { recursive: true, force: true });
