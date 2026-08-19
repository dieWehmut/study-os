import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

test("Vitest excludes both browser Playwright suites", () => {
  const config = fs.readFileSync(path.join(repositoryRoot, "frontend/vite.config.ts"), "utf8")

  assert.match(config, /exclude:\s*\[[\s\S]*["']e2e\/\*\*["'][\s\S]*\]/)
  assert.match(config, /exclude:\s*\[[\s\S]*["']e2e-pages\/\*\*["'][\s\S]*\]/)
})
