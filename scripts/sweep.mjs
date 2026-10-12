#!/usr/bin/env node
// The whole verification sweep, in one command, with failures kept.
//
// Three times now a rare test failure was seen and then thrown away: the output
// was piped through a filter that kept the test's name and dropped the assertion
// text, and once the log was deleted a moment later. The fix is not resolve, it is
// structure: every step here lets its output through untouched, and the vitest
// step runs through scripts/flake-hunt.mjs so the assertion text also lands in a
// JSON report on disk.
//
//   node scripts/sweep.mjs [--only=<step>]...
//
// Steps, in the order they run: go, vitest, lint, e2e, pages, docs, build.
//
// build is last on purpose (it validates the normal variant and leaves the repository
// with that build in dist), and --only=docs inserts a pages-build before the docs tests,
// which drags a second, final build behind it. The list used to say "build" before
// "e2e", which is not what this file does -- an outdated sentence reads exactly like a
// wrong one (§七 of ROADMAP).
import { mkdirSync, readdirSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Windows needs a shell for pnpm/npx, and node prints DEP0190 for each spawn. This
// script's whole job is to keep output readable, so that one warning is off rather
// than repeated five times per sweep.
process.noDeprecation = true

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const frontend = join(root, "frontend")
const reports = join(root, "flake", `sweep-${new Date().toISOString().replace(/[:.]/g, "-")}`)

const only = process.argv.slice(2)
  .filter((argument) => argument.startsWith("--only="))
  .flatMap((argument) => argument.slice("--only=".length).split(","))
  .filter(Boolean)

/**
 * Kill Playwright's own orphaned browsers before starting.
 *
 * Round 219: two tests looked reproducibly broken -- failures that moved between files,
 * a collection-time error, and every step running 8-10x slower (go vet 8s -> 86s). The
 * cause was leftover browsers from interrupted e2e runs competing for the machine:
 * clearing them took one heavy test file from 33.9s to 9.35s and the sweep went green.
 *
 * Only processes launched from Playwright's bundled browser directory are touched, and
 * only when the sweep is about to run (or when asked): the user's own Chrome lives
 * somewhere else and is never a candidate. An empty result is the normal case.
 */
function clearStrayBrowsers() {
  if (process.platform !== "win32") return
  const query = [
    "Get-Process -Name chrome,chromium,msedge -ErrorAction SilentlyContinue",
    "| Where-Object { $_.Path -like '*ms-playwright*' }",
    "| ForEach-Object { $_.Id }",
  ].join(" ")
  const found = spawnSync("pwsh", ["-NoProfile", "-Command", query], { encoding: "utf8" })
  const ids = (found.stdout ?? "").split(/\s+/).filter((value) => /^\d+$/.test(value))
  if (ids.length === 0) return
  spawnSync("pwsh", ["-NoProfile", "-Command", `Stop-Process -Id ${ids.join(",")} -Force -ErrorAction SilentlyContinue`])
  console.log(`cleared ${ids.length} orphaned Playwright browser process(es) before the sweep`)
}

function run(command, args, options = {}) {
  const label = [command, ...args].join(" ")
  console.log(`\n=== ${options.title ?? label} ===`)
  const startedAt = Date.now()
  // The package runners are .cmd shims on Windows, so they need a shell -- and node
  // warns once per spawn when one is used. Spawning the shim directly without a shell
  // looked tidier and did not work: it exited non-zero with no output at all, which is
  // exactly the kind of silence this script exists to prevent. The warning is turned
  // off instead (see the top of the file), and every step still prints its own output.
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
    shell: process.platform === "win32" && (command === "pnpm" || command === "npx"),
  })
  // Timed per step: the suite grows a file at a time, and "which step got slower" is
  // the first question when a sweep starts taking too long to run before a commit.
  return { label, status: result.status ?? 1, ms: Date.now() - startedAt }
}

// The order is the object's order, and it is deliberate: the Pages build has to be
// in dist when the artifact test reads it, and the normal build has to be last so it
// both validates that variant and leaves the repository in it. A sweep of this used
// to build three times (normal, pages, normal again) -- e2e runs against the vite dev
// server and never reads dist, so the first one bought nothing.
const steps = {
  go: () => [
    run("go", ["vet", "./..."]),
    run("go", ["test", "./..."]),
  ],
  vitest: () => [run("node", ["scripts/flake-hunt.mjs", "1", reports], { title: "vitest (full, via flake-hunt)" })],
  lint: () => [run("pnpm", ["--dir", "frontend", "lint"])],
  e2e: () => [run("npx", ["playwright", "test"], { cwd: frontend, title: "e2e (desktop + mobile)" })],
  pages: () => [
    run("pnpm", ["--dir", "frontend", "build"], { env: { VITE_STATIC_DEMO: "true", VITE_BASE_PATH: "/study-os/" }, title: "pages build" }),
    run("npx", ["playwright", "test", "--config=playwright.pages.config.ts"], { cwd: frontend, env: { PAGES_PREVIEW: "true" }, title: "pages smoke" }),
  ],
  docs: () => {
    const results = []
    for (const entry of readdirSync(join(root, "scripts", "tests"))) {
      if (!entry.endsWith(".test.mjs")) continue
      results.push(run("node", [join("scripts", "tests", entry)], { title: entry }))
    }
    return results
  },
  build: () => [run("pnpm", ["--dir", "frontend", "build"], { title: "build (normal, leaves dist ready)" })],
}

const selected = only.length > 0 ? only.filter((name) => name in steps) : Object.keys(steps)
if (selected.length === 0) {
  console.error(`nothing to run: ${only.join(", ")} matched no step`)
  process.exit(2)
}

mkdirSync(reports, { recursive: true })
const results = []
const order = [...selected]
// github-pages-artifact.test.mjs reads the Pages *demo* build out of dist, so asking
// for the docs tests alone is asking for a failure unless the demo build is what is
// sitting there. Build it first instead of reporting a red that means nothing.
const needsDemoBuild = order.includes("docs") && !order.includes("pages") && !order.includes("pages-build")
if (needsDemoBuild) order.splice(order.indexOf("docs"), 0, "pages-build")
// Whatever ordered the demo build into dist leaves the repository with it, so the
// normal build goes at the end -- validating that variant and restoring it.
if ((order.includes("pages") || order.includes("pages-build")) && !order.includes("build")) {
  order.push("build")
}

const stepsWithHelpers = {
  ...steps,
  // The demo build stays in dist on purpose: the artifact test reads it, so the normal
  // build has to come after docs. It is the same command as `build`, only ordered.
  "pages-build": () => [
    run("pnpm", ["--dir", "frontend", "build"], {
      env: { VITE_STATIC_DEMO: "true", VITE_BASE_PATH: "/study-os/" },
      title: "pages build (needed by the artifact test)",
    }),
  ],
}

for (const name of order) {
  // Before the first step, not after a failure: the whole point is that the sweep is
  // measuring the code rather than whatever an interrupted earlier run left behind.
  if (name === order[0]) clearStrayBrowsers()
  for (const result of stepsWithHelpers[name]()) {
    results.push({ step: name, ...result })
    if (result.status !== 0) break
  }
  if (results.some((entry) => entry.status !== 0)) break
}

console.log("\n=== sweep ===")
for (const result of results) {
  const seconds = ((result.ms ?? 0) / 1000).toFixed(1).padStart(6)
  console.log(`${result.status === 0 ? "ok  " : "FAIL"} ${seconds}s  ${result.label}`)
}
const total = results.reduce((sum, result) => sum + (result.ms ?? 0), 0)
console.log(`\n${results.length} steps in ${(total / 1000).toFixed(1)}s`)
const failed = results.filter((result) => result.status !== 0)
if (failed.length > 0) {
  console.log(`\nstopped at: ${failed[0].label}`)
  console.log(`vitest reports (if that step ran): ${reports}`)
  process.exit(1)
}
rmSync(reports, { recursive: true, force: true })
console.log("\nevery step passed")