import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8")
}

test("Pages workflow builds and publishes only the static frontend", () => {
  const workflow = read(".github/workflows/deploy-pages.yml")

  assert.match(workflow, /VITE_STATIC_DEMO:\s*["']?true/)
  assert.ok(workflow.includes("VITE_BASE_PATH: /${{ github.event.repository.name }}/"))
  assert.match(workflow, /path:\s*frontend\/dist/)
  assert.match(workflow, /actions\/upload-pages-artifact@v3/)
  assert.match(workflow, /actions\/deploy-pages@v4/)
  assert.doesNotMatch(workflow, /actions\/setup-go|go build|go run/)
})

test("frontend assets and routing are repository-subpath safe", () => {
  const index = read("frontend/index.html")
  const manifest = read("frontend/public/manifest.webmanifest")
  const vite = read("frontend/vite.config.ts")
  const main = read("frontend/src/main.tsx")

  assert.match(index, /%BASE_URL%favicon\.svg/)
  assert.match(index, /%BASE_URL%manifest\.webmanifest/)
  assert.match(manifest, /"start_url":\s*"\.\/"/)
  assert.match(manifest, /"scope":\s*"\.\/"/)
  assert.match(vite, /base:\s*normalizeBasePath\(process\.env\.VITE_BASE_PATH\)/)
  assert.match(vite, /VITE_STATIC_DEMO/)
  assert.match(main, /HashRouter/)
})
