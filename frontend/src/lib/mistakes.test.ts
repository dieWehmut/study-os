import { beforeEach, describe, expect, it } from "vitest"

import {
  MISTAKE_CAUSES,
  mistakesStorageKey,
  readMistakes,
  summarizeMistakes,
  writeMistakes,
  type MistakeCause,
  type MistakeRecord,
} from "./mistakes"

function record(cause: MistakeCause, id: string = cause): MistakeRecord {
  return { id, subject: "biology", question: "题", cause, createdAt: "2026-08-08T00:00:00Z" }
}

describe("mistake causes", () => {
  it("says of each cause whether more review would fix it", () => {
    // This is the whole point of naming a cause. The app already reschedules
    // everything you get wrong; a 审题 slip fed into that queue just reshuffles
    // a card that was never the problem.
    for (const spec of MISTAKE_CAUSES) {
      expect(typeof spec.reviewFixes).toBe("boolean")
      expect(spec.action.length).toBeGreaterThan(0)
    }
  })

  it("agrees that forgetting is the one review is built for", () => {
    const recall = MISTAKE_CAUSES.find((spec) => spec.cause === "recall")
    expect(recall?.reviewFixes).toBe(true)
  })

  it("does not pretend review fixes a misread question", () => {
    const misread = MISTAKE_CAUSES.find((spec) => spec.cause === "misread")
    expect(misread?.reviewFixes).toBe(false)
  })
})

describe("summarizing mistakes", () => {
  it("has nothing to say before anything went wrong", () => {
    const summary = summarizeMistakes([])

    expect(summary.total).toBe(0)
    expect(summary.byCause).toEqual([])
  })

  it("puts the cause you hit most often first", () => {
    const summary = summarizeMistakes([
      record("careless", "a"),
      record("recall", "b"),
      record("careless", "c"),
    ])

    expect(summary.byCause[0].spec.cause).toBe("careless")
    expect(summary.byCause[0].count).toBe(2)
  })

  it("leaves out the causes you have never hit", () => {
    // Seven rows of zero bury the two that matter.
    const summary = summarizeMistakes([record("recall")])

    expect(summary.byCause).toHaveLength(1)
  })

  it("keeps tied causes in a fixed order, so the list does not reshuffle", () => {
    const first = summarizeMistakes([record("recall", "a"), record("careless", "b")])
    const second = summarizeMistakes([record("careless", "b"), record("recall", "a")])

    expect(first.byCause.map((entry) => entry.spec.cause)).toEqual(
      second.byCause.map((entry) => entry.spec.cause),
    )
  })

  it("separates what review will fix from what it will not", () => {
    // The number that decides what to do next: reviewing harder cannot help
    // three of these four, and only this split says so.
    const summary = summarizeMistakes([
      record("recall", "a"),
      record("misread", "b"),
      record("careless", "c"),
      record("time", "d"),
    ])

    expect(summary.reviewFixable).toBe(1)
    expect(summary.needsOtherFix).toBe(3)
  })

  it("gives each cause its share of the whole", () => {
    const summary = summarizeMistakes([record("recall", "a"), record("careless", "b")])

    expect(summary.byCause[0].percent).toBe(50)
  })
})

describe("keeping the log", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("starts empty rather than guessing, when nothing was ever saved", () => {
    expect(readMistakes()).toEqual([])
  })

  it("hands back the same log it was given", () => {
    // The whole point of asking someone to file a mistake is that the answer
    // outlives the tab it was typed in.
    const log = [record("recall", "a"), record("misread", "b")]
    writeMistakes(log)

    expect(readMistakes()).toEqual(log)
  })

  it("shrugs off a blob that is not a log at all", () => {
    localStorage.setItem(mistakesStorageKey, "{ not json")

    expect(readMistakes()).toEqual([])
  })

  it("does not take an object where a list belongs", () => {
    localStorage.setItem(mistakesStorageKey, JSON.stringify({ recall: 3 }))

    expect(readMistakes()).toEqual([])
  })

  it("drops a row that is missing the parts that make it a record", () => {
    localStorage.setItem(
      mistakesStorageKey,
      JSON.stringify([{ id: "a", cause: "recall" }, record("misread", "b")]),
    )

    expect(readMistakes()).toEqual([record("misread", "b")])
  })

  it("drops a cause it no longer recognizes", () => {
    // The page looks each cause up in the taxonomy to draw its label. A row
    // naming a cause that has since been renamed would render a blank badge
    // and count toward a total it belongs to nowhere in.
    localStorage.setItem(
      mistakesStorageKey,
      JSON.stringify([{ ...record("recall", "a"), cause: "vibes" }, record("recall", "b")]),
    )

    expect(readMistakes()).toEqual([record("recall", "b")])
  })
})
