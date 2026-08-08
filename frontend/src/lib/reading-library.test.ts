import { beforeEach, describe, expect, it } from "vitest"

import {
  forgetDocument,
  readShelf,
  readingLibraryStorageKey,
  restoreDocument,
  shelveDocument,
} from "./reading-library"

const photosynthesis = ["# 光合作用", "## 光反应", "在类囊体薄膜上进行。"].join("\n")
const kinetics = ["# 动能定理", "## 适用条件", "只对合外力做功成立。"].join("\n")

function session(
  markdown: string,
  index = 0,
  readIds: string[] = [],
  stuckIds: string[] = [],
  keptIds: string[] = [],
) {
  return { markdown, index, readIds, stuckIds, keptIds }
}

describe("the reading shelf", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("starts empty, because nothing has been put away yet", () => {
    expect(readShelf()).toEqual([])
  })

  it("keeps the document with everything you had marked on it", () => {
    // Putting a document away and getting back only its text would throw away
    // the reading -- the marks are the work, the text is just the input.
    shelveDocument(session(photosynthesis, 1, ["n0-0-p0"], ["n0-0-p0"], ["n0-0-p0"]))

    const [shelved] = readShelf()
    expect(shelved.markdown).toBe(photosynthesis)
    expect(shelved.index).toBe(1)
    expect(shelved.readIds).toEqual(["n0-0-p0"])
    expect(shelved.stuckIds).toEqual(["n0-0-p0"])
    expect(shelved.keptIds).toEqual(["n0-0-p0"])
  })

  it("puts the one you just closed at the front", () => {
    // The shelf is read as a list of what to go back to, and the thing you
    // just walked away from is the likeliest of those.
    shelveDocument(session(photosynthesis))
    shelveDocument(session(kinetics))

    expect(readShelf().map((entry) => entry.markdown)).toEqual([kinetics, photosynthesis])
  })

  it("tells apart two documents put away in the same millisecond", () => {
    // A clock-only id collides here, and a collision means 删除 or 打开 takes
    // the row next to the one you meant.
    shelveDocument(session(photosynthesis))
    shelveDocument(session(kinetics))

    const [first, second] = readShelf()
    expect(first.id).not.toBe(second.id)
  })

  it("does not shelve an empty box, because there is nothing to keep", () => {
    shelveDocument(session(""))

    expect(readShelf()).toEqual([])
  })

  it("does not shelve a box holding only whitespace", () => {
    shelveDocument(session("   \n  "))

    expect(readShelf()).toEqual([])
  })

  it("drops the oldest once the shelf is full, rather than growing forever", () => {
    for (let i = 0; i < 14; i += 1) {
      shelveDocument(session(`# 第 ${i} 篇`))
    }

    const shelf = readShelf()
    expect(shelf).toHaveLength(12)
    expect(shelf[0].markdown).toBe("# 第 13 篇")
    expect(shelf.map((entry) => entry.markdown)).not.toContain("# 第 0 篇")
  })

  it("hands a document back with its marks and takes it off the shelf", () => {
    shelveDocument(session(photosynthesis, 1, ["n0-0-p0"], []))
    const [shelved] = readShelf()

    expect(restoreDocument(shelved.id)).toEqual(session(photosynthesis, 1, ["n0-0-p0"], []))
    expect(readShelf()).toEqual([])
  })

  it("leaves the shelf alone when asked for a document that is not on it", () => {
    shelveDocument(session(photosynthesis))

    expect(restoreDocument("never-shelved")).toBeNull()
    expect(readShelf()).toHaveLength(1)
  })

  it("throws a document away for good, since a full shelf is unreadable", () => {
    shelveDocument(session(photosynthesis))
    const [shelved] = readShelf()

    expect(forgetDocument(shelved.id)).toEqual([])
    expect(readShelf()).toEqual([])
  })

  it("takes only the one you named, in a shelf that keeps its order", () => {
    // Getting this wrong loses a document nobody asked to delete, and there is
    // nowhere to get it back from.
    shelveDocument(session(photosynthesis))
    shelveDocument(session(kinetics))
    const [newest] = readShelf()

    forgetDocument(newest.id)

    expect(readShelf().map((entry) => entry.markdown)).toEqual([photosynthesis])
  })

  it("leaves the shelf alone when told to forget something not on it", () => {
    shelveDocument(session(photosynthesis))

    expect(forgetDocument("never-shelved")).toHaveLength(1)
    expect(readShelf()).toHaveLength(1)
  })

  it("shrugs off a blob that is not a shelf", () => {
    localStorage.setItem(readingLibraryStorageKey, "{ not json")

    expect(readShelf()).toEqual([])
  })

  it("drops a row it cannot describe rather than showing a blank document", () => {
    // Better to lose the row than to put an untitled, textless entry on a
    // shelf whose whole job is to say what is on it.
    localStorage.setItem(
      readingLibraryStorageKey,
      JSON.stringify([
        { id: "a", shelvedAt: 1, markdown: photosynthesis, index: 0, readIds: [], stuckIds: [] },
        { id: "b", shelvedAt: 2 },
        { markdown: kinetics },
      ]),
    )

    expect(readShelf().map((entry) => entry.id)).toEqual(["a"])
  })
})
