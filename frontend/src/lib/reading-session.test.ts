import { beforeEach, describe, expect, it } from "vitest"

import {
  emptyReadingSession,
  readReadingSession,
  readingStorageKey,
  summarizeReadingSession,
  writeReadingSession,
} from "./reading-session"

describe("the reading session", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("opens on an empty page when there is nothing to come back to", () => {
    expect(readReadingSession()).toEqual(emptyReadingSession)
  })

  it("hands back the document, the place and the marks together", () => {
    // The three are one fact. A mark names a chunk id, and chunk ids are
    // derived from the document's own shape, so marks without the text they
    // were made against belong to nothing.
    const session = { markdown: "# 一\n正文", index: 2, readIds: ["h1-0-p0"] }
    writeReadingSession(session)

    expect(readReadingSession()).toEqual(session)
  })

  it("shrugs off a blob that is not a session", () => {
    localStorage.setItem(readingStorageKey, "{ not json")

    expect(readReadingSession()).toEqual(emptyReadingSession)
  })

  it("refuses a session with no document, marks and all", () => {
    // Restoring a place in a document that is not there would put the reader
    // at stop 3 of nothing.
    localStorage.setItem(readingStorageKey, JSON.stringify({ index: 3, readIds: ["a"] }))

    expect(readReadingSession()).toEqual(emptyReadingSession)
  })

  it("does not restore a place before the beginning", () => {
    localStorage.setItem(
      readingStorageKey,
      JSON.stringify({ markdown: "# 一", index: -4, readIds: [] }),
    )

    expect(readReadingSession().index).toBe(0)
  })

  it("rounds a fractional place down to a real stop", () => {
    localStorage.setItem(
      readingStorageKey,
      JSON.stringify({ markdown: "# 一", index: 2.7, readIds: [] }),
    )

    expect(readReadingSession().index).toBe(2)
  })

  it("keeps only the marks that are strings", () => {
    localStorage.setItem(
      readingStorageKey,
      JSON.stringify({ markdown: "# 一", index: 0, readIds: ["a", 7, null, "b"] }),
    )

    expect(readReadingSession().readIds).toEqual(["a", "b"])
  })

  it("treats a missing mark list as no marks rather than giving up the document", () => {
    localStorage.setItem(readingStorageKey, JSON.stringify({ markdown: "# 一", index: 1 }))

    expect(readReadingSession()).toEqual({ markdown: "# 一", index: 1, readIds: [] })
  })

  it("forgets the document once you clear the box", () => {
    writeReadingSession({ markdown: "# 一", index: 1, readIds: ["a"] })

    writeReadingSession(emptyReadingSession)

    expect(localStorage.getItem(readingStorageKey)).toBeNull()
  })
})

describe("summarizing what is left to read", () => {
  const source = ["# 光合作用", "## 光反应", "在类囊体薄膜上进行。", "## 暗反应", "在叶绿体基质中进行。"].join("\n")

  it("has nothing to offer when no document was left open", () => {
    expect(summarizeReadingSession(emptyReadingSession)).toBeNull()
  })

  it("names the document by its own title, not by its first line of prose", () => {
    const summary = summarizeReadingSession({ markdown: source, index: 0, readIds: [] })

    expect(summary?.title).toBe("光合作用")
  })

  it("counts the stops still ahead, which is what decides whether to go back", () => {
    const chunks = ["# 一", "## A", "甲。", "## B", "乙。"].join("\n")
    const summary = summarizeReadingSession({ markdown: chunks, index: 0, readIds: [] })

    expect(summary?.total).toBe(2)
    expect(summary?.remaining).toBe(2)
  })

  it("counts a stop as behind you only once it is marked", () => {
    // Walking past a stop is not reading it. Only the mark says you did.
    const summary = summarizeReadingSession({
      markdown: source,
      index: 1,
      readIds: ["n0-0-p0"],
    })

    expect(summary?.read).toBe(1)
    expect(summary?.remaining).toBe(1)
  })

  it("ignores a mark naming a stop this document no longer has", () => {
    // The document was edited under the marks; a stale id must not push the
    // count past the number of stops that exist.
    const summary = summarizeReadingSession({
      markdown: source,
      index: 0,
      readIds: ["gone", "also-gone"],
    })

    expect(summary?.read).toBe(0)
    expect(summary?.remaining).toBe(2)
  })

  it("falls back to a plain label when the document has no heading at all", () => {
    const summary = summarizeReadingSession({ markdown: "只有正文，没有标题。", index: 0, readIds: [] })

    expect(summary?.title).toBe("未命名文档")
  })

  it("has nothing to offer for text that produced no stops", () => {
    expect(summarizeReadingSession({ markdown: "   ", index: 0, readIds: [] })).toBeNull()
  })
})
