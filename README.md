# Bundled Eve functions resolve `eve/package.json` at runtime

Minimal reproduction for [vercel/eve](https://github.com/vercel/eve) **bundled/serverless package identity probing** — not a request to add Bun support.

When Eve is built for Vercel (Nitro `vercel` preset), the output `.func` directories contain bundled Eve chunks but **no installed `node_modules/eve`**. At cold start, `workflow-runtime` module initialization calls `resolveInstalledPackageInfo()`, which probes `require.resolve("eve/package.json")` even though Eve already stamps `BUNDLED_FALLBACK_PACKAGE_VERSION` at build time for exactly this scenario.

## Scaffold

Created with the documented Eve init flow:

```bash
npx eve@latest init .
```

This repo keeps the default scaffold (`agent/`, `eve@0.44.3`) and adds only the reproduction scripts under `repro/`.

## Root cause (Eve-owned)

Call chain on published `eve@0.44.3` (unchanged on current `main`):

1. [`workflow-runtime.ts`](https://github.com/vercel/eve/blob/main/packages/eve/src/execution/workflow-runtime.ts) — `const EVE_PACKAGE_INFO = resolveInstalledPackageInfo()` at **module load** (before `/eve/v1/health`).
2. [`resolveInstalledPackageInfo`](https://github.com/vercel/eve/blob/main/packages/eve/src/internal/application/package.ts) → `tryResolvePackageRoot()` → `resolvePackageLocationFromModulePath()` → `createRequire(module).resolve("eve/package.json")`.
3. If that fails, `resolveInstalledPackageInfo` **probes again** with `require.resolve("eve/package.json")`, then uses stamped `FALLBACK_PACKAGE_INFO`.

Nitro correctly omits `node_modules/eve` from `.func` bundles. Eve then asks the package manager to locate a package that was intentionally not shipped.

### Node vs Bun

| Runtime | When `eve/package.json` is missing |
|---------|-------------------------------------|
| **Node** | `require.resolve` throws `MODULE_NOT_FOUND` — caught; stamped fallback used |
| **Bun 1.4** (Vercel `bun1.x`, default `install.auto`) | PackageManager may attempt `mkdir node_modules/.cache` under the function root; read-only FS → **`bun is unable to write files: ReadOnlyFileSystem`** via `Global.crash()` (not a catchable JS error) |

Related but **out of scope** for this bug: [eve#101](https://github.com/vercel/eve/issues/101), [eve#398](https://github.com/vercel/eve/pull/398), [nitro#4376](https://github.com/nitrojs/nitro/pull/4376).

Historical context: [#948](https://github.com/vercel/eve/issues/948) / [#1182](https://github.com/vercel/eve/pull/1182) added `require.resolve` for bundled **dev-hosts that still have `node_modules/eve`** — which created this latent serverless bug.

---

## A. Architectural reproduction (deterministic, no Vercel)

Simulates a Nitro `.func` layout: bundled chunk files only, empty `node_modules/`, no resolvable `eve/package.json`.

```bash
npm install
npm run repro:architectural
```

This copies `repro/bundled-chunk/` into an isolated temp directory and runs the same `resolveInstalledPackageInfo()` logic Eve executes at `workflow-runtime` init (mirrored from `packages/eve/src/internal/application/package.ts`).

**Expected (Node):** prints stamped fallback `{"name":"eve","version":"0.44.3"}` — probe throws internally but is caught.

```bash
npm run repro:raw-resolve
```

Shows the raw `require.resolve("eve/package.json")` probe from a bundled-module path. Node reports `{"caught":"MODULE_NOT_FOUND"}`.

Optional read-only cwd (mimics Vercel function roots):

```bash
node repro/architectural.mjs --read-only
node repro/raw-resolve-probe.mjs --read-only
```

> **Note:** Bun’s fatal `ReadOnlyFileSystem` crash is most reliably observed on Vercel’s read-only function filesystem (see section B). Locally, Bun may still throw `MODULE_NOT_FOUND` for bare `require.resolve` depending on cache/home writability.

---

## B. Vercel proof (validated on Vercel Bun 1.4)

End-to-end evidence from an Eve agent deployed with `vercel.json` `{ "bunVersion": "1.4.x" }` and Nitro `bun1.x` runtime (no architectural repro scripts required):

On the failing deploy, cold-starting `GET /eve/v1/health` crashes during `workflow-runtime` module init when `resolveInstalledPackageInfo()` probes `require.resolve("eve/package.json")`. Bun 1.4's default package auto-install attempts `mkdir node_modules/.cache` under the read-only function root → `bun is unable to write files: ReadOnlyFileSystem` (not a catchable JS error). Next.js routes on the same deployment survived because they never invoke that probe.

| Deploy | Eve `/eve/v1/health` | Error |
|--------|----------------------|-------|
| [`dpl_GvJAuXqraWu5BCzGck6FDT6sVFyw`](https://eve-bun-spike-12t6s8l39-redstone-labs-ai.vercel.app) | **FAIL** | `FUNCTION_INVOCATION_FAILED`, logs: `bun is unable to write files: ReadOnlyFileSystem` |
| [`dpl_HCbRYc251W6hrsJ8gvxgLyaXJ1ZH`](https://vercel.com/redstone-labs-ai/eve-bun-spike/HCbRYc251W6hrsJ8gvxgLyaXJ1ZH) (workaround: disable Bun auto-install in `.func`) | **PASS** | session → stream → tool → workflow → AI Gateway all succeeded |

After suppressing Bun auto-install in the generated Eve `.func` (`bunfig.toml` `[install] auto = "disable"`), the **same bundled artifact** worked through session, streaming, authored tools, workflow orchestration, and AI Gateway — confirming the crash is the package probe / auto-install path, not Eve application logic or workflow world storage.

---

## Suggested upstream direction (question, not demand)

Eve already stamps `__EVE_PACKAGE_VERSION__` at package build ([`stamp-version-tokens.mjs`](https://github.com/vercel/eve/blob/main/packages/eve/scripts/stamp-version-tokens.mjs)). For bundled/serverless runtimes where `node_modules/eve` is intentionally absent, could package **identity** (`name`/`version`) come from that stamp without calling `require.resolve("eve/package.json")` at module init — while preserving installed-package resolution for unbundled CLI/dev and #948-style hosts that still have `node_modules/eve`?

---

## Files

| Path | Purpose |
|------|---------|
| `repro/bundled-chunk/` | Simulated Nitro `.func` chunk layout (no `node_modules/eve`) |
| `repro/architectural.mjs` | Isolated-dir runner for `resolveInstalledPackageInfo` mirror |
| `repro/raw-resolve-probe.mjs` | Raw `require.resolve("eve/package.json")` probe |
| `agent/` | Default `npx eve@latest init` scaffold (unchanged) |

## Environment

```
eve@0.44.3
Node 24.x
```
