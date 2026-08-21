import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const assets = [
  {
    path: "frontend/public/content/english/word-wiki-moc.md",
    heading: "Word Wiki 索引（3913 词）",
    minimumLinks: 3900,
  },
  {
    path: "frontend/public/content/english/multiword-expression-moc.md",
    heading: "多词表达 wiki · 索引",
    minimumLinks: 1500,
  },
]

test("the two built-in English corpora are stable public assets", () => {
  for (const asset of assets) {
    const absolute = path.join(root, asset.path)
    assert.ok(fs.existsSync(absolute), `${asset.path} is missing`)
    const markdown = fs.readFileSync(absolute, "utf8")
    assert.match(markdown, new RegExp(asset.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.ok((markdown.match(/\[\[[^\]]+\]\]/g) ?? []).length >= asset.minimumLinks)
  }
})

test("temporary prompt names no longer own production corpora", () => {
  assert.equal(fs.existsSync(path.join(root, "prompt/00-MOC.md")), false)
  assert.equal(fs.existsSync(path.join(root, "prompt/00-MOC (1).md")), false)
})
