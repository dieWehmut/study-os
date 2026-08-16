import { describe, expect, it } from "vitest"

import {
  createVocabularyMatcher,
  findProtectedSpans,
  type VocabularyToken,
} from "./vocabulary-matcher"

const entries = [
  { normalized: "at", display: "at", kind: "word" as const },
  { normalized: "last", display: "last", kind: "word" as const },
  { normalized: "at last", display: "at last", kind: "expression" as const },
  { normalized: "he", display: "he", kind: "word" as const },
]

const publicToken = (token: VocabularyToken) => ({
  start: token.start,
  end: token.end,
  text: token.text,
  normalized: token.normalized,
  term: token.term,
  kind: token.kind,
})

describe("createVocabularyMatcher", () => {
  it("uses the longest expression and preserves unmatched text and spans", () => {
    const tokens = createVocabularyMatcher(entries)("At last, he left.")

    expect(tokens.map(publicToken)).toEqual([
      { start: 0, end: 7, text: "At last", normalized: "at last", term: "at last", kind: "expression" },
      { start: 7, end: 9, text: ", ", normalized: null, term: null, kind: null },
      { start: 9, end: 11, text: "he", normalized: "he", term: "he", kind: "word" },
      { start: 11, end: 17, text: " left.", normalized: null, term: null, kind: null },
    ])
    expect(tokens[0]?.entry).toEqual(entries[2])
  })

  it("does not match inside a larger English word and does not stem", () => {
    const match = createVocabularyMatcher([
      { normalized: "the", display: "the", kind: "word" as const },
      { normalized: "walk", display: "walk", kind: "word" as const },
    ])

    expect(match("theatre walked").every((token) => token.term === null)).toBe(true)
    expect(match("walked").every((token) => token.term === null)).toBe(true)
    expect(match("the, walk!").filter((token) => token.term !== null).map((token) => token.term)).toEqual([
      "the",
      "walk",
    ])
  })

  it("treats Unicode letters as word-boundary characters", () => {
    const match = createVocabularyMatcher([
      { normalized: "caf", display: "caf", kind: "word" as const },
    ])

    expect(match("caf\u00e9").every((token) => token.term === null)).toBe(true)
  })

  it("matches case-insensitively after NFKC normalization while preserving source text", () => {
    const match = createVocabularyMatcher([
      { normalized: "at last", display: "at last", kind: "expression" as const },
    ])

    const tokens = match("\uFF21\uFF34\u00a0LAST")
    expect(tokens[0]?.text).toBe("\uFF21\uFF34\u00a0LAST")
    expect(tokens[0]?.normalized).toBe("at last")
    expect(tokens[0]?.start).toBe(0)
    expect(tokens[0]?.end).toBe("\uFF21\uFF34\u00a0LAST".length)
  })

  it("does not emit overlapping tokens when NFKC expands one source character", () => {
    const match = createVocabularyMatcher([
      { normalized: "f", display: "f", kind: "word" as const },
    ])

    const tokens = match("\uFB03")
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.text).toBe("\uFB03")
    expect([tokens[0]?.start, tokens[0]?.end]).toEqual([0, 1])
  })

  it("protects fenced code, inline code, and Markdown link destinations", () => {
    const markdown = "At `last` [at](https://example.test/at)\n```\nat last\n```"
    const match = createVocabularyMatcher(entries)
    const tokens = match(markdown)

    expect(tokens.filter((token) => token.term !== null).map((token) => token.text)).toEqual(["At"])
    expect(findProtectedSpans(markdown)).toEqual([
      { start: 3, end: 9 },
      { start: 10, end: 39 },
      { start: 40, end: markdown.length },
    ])
  })

  it("returns deterministic, non-overlapping tokens for repeated matches", () => {
    const text = "he he"
    const tokens = createVocabularyMatcher(entries)(text)
    expect(tokens.map((token) => [token.start, token.end])).toEqual([
      [0, 2],
      [2, 3],
      [3, 5],
    ])
    expect(tokens.map((token) => token.text).join("")).toBe(text)
  })
})
