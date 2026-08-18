import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const dist = path.resolve(repositoryRoot, process.env.PAGES_DIST || "frontend/dist")
const expectedBase = process.env.PAGES_BASE_PATH || "/study-os/"

function read(relativePath) {
  return fs.readFileSync(path.join(dist, relativePath), "utf8")
}

test("Pages artifact keeps every generated public reference under its base path", () => {
  assert.ok(fs.existsSync(path.join(dist, "index.html")), `missing ${dist}/index.html`)
  const index = read("index.html")
  const references = [...index.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
  const publicReferences = references.filter((reference) => reference.startsWith("/"))

  assert.ok(publicReferences.length > 0)
  for (const reference of publicReferences) {
    assert.ok(reference.startsWith(expectedBase), `${reference} is outside ${expectedBase}`)
  }
})

test("Pages manifest is relative and the static bundle has no backend startup artifact", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"))
  assert.equal(manifest.start_url, "./")
  assert.equal(manifest.scope, "./")

  const assetDirectory = path.join(dist, "assets")
  const javascript = fs.readdirSync(assetDirectory)
    .filter((file) => file.endsWith(".js"))
    .map((file) => fs.readFileSync(path.join(assetDirectory, file), "utf8"))
    .join("\n")

  assert.doesNotMatch(javascript, /127\.0\.0\.1:8080/)
  assert.doesNotMatch(javascript, /study-os:backend-server/)
})
