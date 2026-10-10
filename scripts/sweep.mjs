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
// Steps: go, vitest, lint, build, e2e, pages, docs
import { mkdirSync, readdirSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const frontend = join(root, "frontend")
const reports = join(root, "flake", `sweep-${new Date().toISOString().replace(/[:.]/g, "-")}`)

const only = process.argv.slice(2)
  .filter((argument) => argument.startsWith("--only="))
  .flatMap((argument) => argument.slice("--only=".length).split(","))
  .filter(Boolean)

function run(command, args, options = {}) {
  const label = [command, ...args].join(" ")
  console.log(`\n=== ${options.title ?? label} ===`)
  // Only the package runners need a shell on Windows; passing everything through
  // one makes node warn about unescaped arguments on every step.
  const needsShell = process.platform === "win32" && (command === "pnpm" || command === "npx")
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
    shell: needsShell,
  })
  return { label, status: result.status ?? 1 }
}

const steps = {
  go: () => [
    run("go", ["vet", "./..."]),
    run("go", ["test", "./..."]),
  ],
  vitest: () => [run("node", ["scripts/flake-hunt.mjs", "1", reports], { title: "vitest (full, via flake-hunt)" })],
  lint: () => [run("pnpm", ["--dir", "frontend", "lint"])],
  build: () => [run("pnpm", ["--dir", "frontend", "build"])],
  e2e: () => [run("npx", ["playwright", "test"], { cwd: frontend, title: "e2e (desktop + mobile)" })],
  pages: () => [
    run("pnpm", ["--dir", "frontend", "build"], { env: { VITE_STATIC_DEMO: "true", VITE_BASE_PATH: "/study-os/" }, title: "pages build" }),
    run("npx", ["playwright", "test", "--config=playwright.pages.config.ts"], { cwd: frontend, env: { PAGES_PREVIEW: "true" }, title: "pages smoke" }),
    // The demo build stays in dist on purpose: the artifact test reads it, and
    // restoring the normal build here is what made that test fail the first time
    // this sweep ran end to end.
  ],
  docs: () => {
    const results = []
    for (const entry of readdirSync(join(root, "scripts", "tests"))) {
      if (!entry.endsWith(".test.mjs")) continue
      results.push(run("node", [join("scripts", "tests", entry)], { title: entry }))
    }
    return results
  },
}

const selected = only.length > 0 ? only.filter((name) => name in steps) : Object.keys(steps)
if (selected.length === 0) {
  console.error(`nothing to run: ${only.join(", ")} matched no step`)
  process.exit(2)
}

mkdirSync(reports, { recursive: true })
const results = []
const order = [...selected]
// Leave the repository with its normal build: the pages step keeps the demo build
// in place so the artifact test can read what was just built.
if (order.includes("pages")) order.push("restore")

const stepsWithRestore = {
  ...steps,
  restore: () => [run("pnpm", ["--dir", "frontend", "build"], { title: "restore the normal build" })],
}

for (const name of order) {
  for (const result of stepsWithRestore[name]()) {
    results.push({ step: name, ...result })
    if (result.status !== 0) break
  }
  if (results.some((entry) => entry.status !== 0)) break
}

console.log("\n=== sweep ===")
for (const result of results) {
  console.log(`${result.status === 0 ? "ok  " : "FAIL"} ${result.label}`)
}
const failed = results.filter((result) => result.status !== 0)
if (failed.length > 0) {
  console.log(`\nstopped at: ${failed[0].label}`)
  console.log(`vitest reports (if that step ran): ${reports}`)
  process.exit(1)
}
rmSync(reports, { recursive: true, force: true })
console.log("\nevery step passed")