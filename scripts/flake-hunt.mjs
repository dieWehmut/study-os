#!/usr/bin/env node
// Hunting the rare one.
//
// A test that fails about once every ten full runs cannot be found by running it
// alone: this file's own history says so. The three attempts before this script
// were "run the file ten times" (clean, three times over) and "run the suite and
// filter the output" (the assertion detail was filtered away with everything
// else). So this does the two things that were missing:
//
//   1. it loops the WHOLE suite -- the failure only appears under that load;
//   2. each run writes vitest's JSON report to disk, so the failure survives even
//      when the terminal output is read through a pipe or a grep.
//
// stdio is inherited rather than captured: piping a child's output is blocked in
// some sandboxes, and the JSON file is a better record than a tee anyway.
//
//   node scripts/flake-hunt.mjs [runs] [output-dir]
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const frontend = resolve(here, "..", "frontend")
const runs = Number(process.argv[2] ?? 10)
const outputDir = resolve(process.argv[3] ?? join(here, "..", "flake"))

mkdirSync(outputDir, { recursive: true })
console.log(`looping the full suite up to ${runs} times; reports in ${outputDir}`)

/** Failed assertions from one vitest JSON report, with the text vitest printed. */
function readFailures(report) {
  if (!existsSync(report)) return []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(report, "utf8"))
  } catch {
    return [{ name: "(unreadable report)", messages: report }]
  }
  const failures = []
  for (const file of parsed.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === "passed" || assertion.status === "skipped") continue
      failures.push({
        name: `${file.name} > ${assertion.fullName}`,
        messages: (assertion.failureMessages ?? []).join("\n"),
      })
    }
  }
  return failures
}

for (let run = 1; run <= runs; run += 1) {
  const report = join(outputDir, `run-${run}.json`)
  rmSync(report, { force: true })
  const result = spawnSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${report}`], {
    cwd: frontend,
    stdio: "inherit",
    shell: process.platform === "win32",
  })

  const failures = readFailures(report)
  if (failures.length > 0) {
    console.log(`\nrun ${run}: ${failures.length} failed`)
    for (const failure of failures) {
      console.log(`\n--- ${failure.name}`)
      console.log(failure.messages)
    }
    console.log(`\nfull report: ${report}`)
    process.exit(1)
  }
  console.log(`run ${run}: clean${result.status === 0 ? "" : ` (vitest exit ${result.status})`}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`\nno failure in ${runs} runs: the test is rarer than that, not fixed.`)
if (!existsSync(join(outputDir, "run-1.json"))) process.exit(1)