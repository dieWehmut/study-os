import { beforeEach, describe, expect, it } from "vitest"

import {
  emptyReadingSession,
  readReadingSession,
  readingStorageKey,
  stuckSections,
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
    const session = { markdown: "# 一\n正文", index: 2, readIds: ["h1-0-p0"], stuckIds: [] }
    writeReadingSession(session)

    expect(readReadingSession()).toEqual(session)
  })

  it("keeps the stops you got stuck on apart from the ones you finished", () => {
    // Finishing a stop and failing to understand it are different facts about
    // it, and both can be true at once: you read the whole thing and still do
    // not have it.
    const session = { markdown: "# 一\n正文", index: 0, readIds: ["a"], stuckIds: ["a", "b"] }
    writeReadingSession(session)

    expect(readReadingSession()).toEqual(session)
  })

  it("keeps only the stuck marks that are strings", () => {
    localStorage.setItem(
      readingStorageKey,
      JSON.stringify({ markdown: "# 一", index: 0, readIds: [], stuckIds: ["a", 7, null] }),
    )

    expect(readReadingSession().stuckIds).toEqual(["a"])
  })

  it("reads a session saved before there was anywhere to record being stuck", () => {
    // Sessions on disk predate the field. Refusing them would empty the box of
    // whoever had a document open when the app updated.
    localStorage.setItem(
      readingStorageKey,
      JSON.stringify({ markdown: "# 一", index: 0, readIds: ["a"] }),
    )

    expect(readReadingSession().stuckIds).toEqual([])
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

    expect(readReadingSession()).toEqual({ markdown: "# 一", index: 1, readIds: [], stuckIds: [] })
  })

  it("forgets the document once you clear the box", () => {
    writeReadingSession({ markdown: "# 一", index: 1, readIds: ["a"], stuckIds: [] })

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
    const summary = summarizeReadingSession({ markdown: source, index: 0, readIds: [], stuckIds: [] })

    expect(summary?.title).toBe("光合作用")
  })

  it("counts the stops still ahead, which is what decides whether to go back", () => {
    const chunks = ["# 一", "## A", "甲。", "## B", "乙。"].join("\n")
    const summary = summarizeReadingSession({ markdown: chunks, index: 0, readIds: [], stuckIds: [] })

    expect(summary?.total).toBe(2)
    expect(summary?.remaining).toBe(2)
  })

  it("counts a stop as behind you only once it is marked", () => {
    // Walking past a stop is not reading it. Only the mark says you did.
    const summary = summarizeReadingSession({
      markdown: source,
      index: 1,
      readIds: ["n0-0-p0"],
      stuckIds: [],
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
      stuckIds: [],
    })

    expect(summary?.read).toBe(0)
    expect(summary?.remaining).toBe(2)
  })

  it("falls back to a plain label when the document has no heading at all", () => {
    const summary = summarizeReadingSession({ markdown: "只有正文，没有标题。", index: 0, readIds: [], stuckIds: [] })

    expect(summary?.title).toBe("未命名文档")
  })

  it("has nothing to offer for text that produced no stops", () => {
    expect(summarizeReadingSession({ markdown: "   ", index: 0, readIds: [], stuckIds: [] })).toBeNull()
  })

  it("counts what is still in the way, not only how far you got", () => {
    // How much is read says whether the document is finished; how much is
    // stuck says whether finishing it was any use. Only the second decides
    // whether going back is worth the trip.
    const summary = summarizeReadingSession({
      markdown: source,
      index: 1,
      readIds: ["n0-0-p0"],
      stuckIds: ["n0-0-p0"],
    })

    expect(summary?.read).toBe(1)
    expect(summary?.stuck).toBe(1)
  })

  it("ignores a flag naming a stop this draft no longer has", () => {
    // Same rule as the read count: the marks were made against whatever was in
    // the box at the time, and a stale id would inflate the number.
    const summary = summarizeReadingSession({
      markdown: source,
      index: 0,
      readIds: [],
      stuckIds: ["gone"],
    })

    expect(summary?.stuck).toBe(0)
  })

  it("has nothing in the way before anything is flagged", () => {
    const summary = summarizeReadingSession({ markdown: source, index: 0, readIds: [], stuckIds: [] })

    expect(summary?.stuck).toBe(0)
  })
})

describe("collecting the sections that did not land", () => {
  const source = ["# 光合作用", "## 光反应", "在类囊体薄膜上进行。", "## 暗反应", "在叶绿体基质中进行。"].join("\n")

  it("has nothing to collect before anything is flagged", () => {
    expect(stuckSections({ markdown: source, index: 0, readIds: [], stuckIds: [] })).toEqual([])
  })

  it("hands back the flagged sections with their words, not just their ids", () => {
    // Whoever these get carried to never saw the document, so an id is not
    // enough -- the section has to arrive with the text under it.
    const sections = stuckSections({ markdown: source, index: 0, readIds: [], stuckIds: ["n0-0-p0"] })

    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBe("光反应")
    expect(sections[0].lines).toContain("在类囊体薄膜上进行。")
  })

  it("drops a flag naming a stop this draft no longer has", () => {
    expect(stuckSections({ markdown: source, index: 0, readIds: [], stuckIds: ["gone"] })).toEqual([])
  })

  it("keeps the document's own order, not the order you flagged them in", () => {
    // The list is read as a table of contents of what is in the way; shuffled
    // into click order it stops lining up with the document.
    const sections = stuckSections({
      markdown: source,
      index: 0,
      readIds: [],
      stuckIds: ["n0-1-p0", "n0-0-p0"],
    })

    expect(sections.map((chunk) => chunk.title)).toEqual(["光反应", "暗反应"])
  })
})
