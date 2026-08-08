import { beforeEach, describe, expect, it } from "vitest"

import {
  emptyReadingSession,
  readReadingSession,
  readingStorageKey,
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
