import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  extractEntries,
  normalizeTerm,
  serializeLexicon,
} from "../vocabulary-lexicon.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

test("normalizes terms with NFKC, case folding, and collapsed whitespace", () => {
  assert.equal(normalizeTerm("  \uFF21\uFF34\u00a0  LAST  "), "at last")
  assert.equal(normalizeTerm("\n\t"), "")
  assert.equal(normalizeTerm(null), "")
})

test("extracts word wiki-link aliases and ignores navigation links", () => {
  const markdown = [
    "[[thesaurus-group/00-index|Browse groups]]",
    "[[word-wiki/Last|  LAST  ]] \u00b7 [[word-wiki/at]]",
    "[[word-wiki/empty|   ]]",
    "[[word-wiki/code|`code`]]",
    "[[word-wiki/url|https://example.test/at]]",
  ].join(" ")

  assert.deepEqual(extractEntries(markdown, "word"), [
    { normalized: "last", display: "LAST", kind: "word" },
    { normalized: "at", display: "at", kind: "word" },
  ])
})

test("extracts expression aliases only from the A-Z list", () => {
  const markdown = [
    "- [[grammar family + \u4e2d\u6587]] \u2014 ignore this family",
    "## A\u2013Z",
    "- [[A as well as B| as well as ]] `fixed-expression`",
    "- [[at last]] \u2014 at the end",
    "- [[empty| ]]",
  ].join("\n")

  const entries = extractEntries(markdown, "expression")
  assert.deepEqual(entries.slice(0, 1), [
    { normalized: "as well as", display: "as well as", kind: "expression" },
  ])
  assert.equal(entries[1]?.normalized, "at last")
  assert.equal(entries[1]?.meaning, "at the end")
  assert.deepEqual(extractEntries("[[at last|At Last]]", "expression"), [
    { normalized: "at last", display: "At Last", kind: "expression" },
  ])
})

test("deduplicates terms and gives expressions priority over words", () => {
  const output = serializeLexicon([
    { normalized: "at", display: "AT", kind: "word" },
    { normalized: "at last", display: "At Last", kind: "expression" },
    { normalized: "AT", display: "at", kind: "word" },
    { normalized: "at", display: "at", kind: "expression" },
    { normalized: "", display: "fallback", kind: "word" },
  ])

  assert.equal((output.match(/normalized: "at"/g) ?? []).length, 1)
  assert.ok(output.indexOf('normalized: "at last"') < output.indexOf('normalized: "at"'))
  assert.match(output, /kind: "expression"/)
})

test("serializes the same lexicon byte-for-byte regardless of input order", () => {
  const entries = [
    { normalized: "zeta", display: "zeta", kind: "word" },
    { normalized: "alpha beta", display: "Alpha Beta", kind: "expression", meaning: "a phrase" },
    { normalized: "alpha", display: "alpha", kind: "word" },
  ]
  const first = serializeLexicon(entries)
  const second = serializeLexicon([...entries].reverse())

  assert.equal(first, second)
  assert.equal(/[^\x00-\x7f]/u.test(first), false)
  assert.match(first, /export interface VocabularyLexiconEntry/)
  assert.match(first, /export const vocabularyLexicon/)
})

test("parses the ignored reference fixtures without importing them at runtime", (t) => {
  const wordsPath = path.join(repositoryRoot, "prompt", "00-MOC.md")
  const expressionsPath = path.join(repositoryRoot, "prompt", "00-MOC (1).md")
  const promptDirectory = path.join(repositoryRoot, "prompt")
  const articleName = fs.existsSync(promptDirectory)
    ? fs.readdirSync(promptDirectory).find((name) => name.startsWith("O01-1 "))
    : undefined

  if (!articleName || !fs.existsSync(wordsPath) || !fs.existsSync(expressionsPath)) {
    t.skip("ignored prompt fixtures are not present in this checkout")
    return
  }

  const words = extractEntries(fs.readFileSync(wordsPath, "utf8"), "word")
  const expressions = extractEntries(fs.readFileSync(expressionsPath, "utf8"), "expression")
  const article = extractEntries(fs.readFileSync(path.join(promptDirectory, articleName), "utf8"), "expression")

  assert.ok(words.length >= 3900)
  assert.ok(expressions.length >= 1500)
  assert.ok(words.some((entry) => entry.normalized === "abandon"))
  assert.ok(expressions.some((entry) => entry.normalized === "as well as"))
  assert.deepEqual(article, [])
})
