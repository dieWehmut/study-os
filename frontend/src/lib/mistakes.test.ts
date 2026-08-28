import { beforeEach, describe, expect, it } from "vitest"

import {
  MISTAKE_CAUSES,
  SUBJECT_CAUSE_ACTIONS,
  causeActionFor,
  createMistake,
  mistakesStorageKey,
  readMistakes,
  summarizeMistakes,
  type MistakeCauseSpec,
  writeMistakes,
  type MistakeCause,
  type MistakeRecord,
} from "./mistakes"
import { guidanceFor } from "./subject-prescriptions"

function record(cause: MistakeCause, id: string = cause): MistakeRecord {
  return { id, subject: "biology", question: "题", cause, createdAt: "2026-08-08T00:00:00Z" }
}

function genericAction(cause: MistakeCause): string {
  const spec = MISTAKE_CAUSES.find((entry) => entry.cause === cause)
  if (!spec) throw new Error(`没有这个错因：${cause}`)
  return spec.action
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

  it("counts what you have put right without pretending it never happened", () => {
    // Dropping a corrected row from the chart would flatten the diagnosis every
    // time you did the right thing. 错在哪一层 answers which layer you fail at,
    // and fixing one instance does not change the answer -- so the row stays in
    // its cause, and 已订正 is counted alongside rather than subtracted.
    const summary = summarizeMistakes([
      { ...record("recall", "a"), corrected: true },
      record("recall", "b"),
      record("careless", "c"),
    ])

    expect(summary.total).toBe(3)
    expect(summary.corrected).toBe(1)
    expect(summary.byCause.find((entry) => entry.spec.cause === "recall")?.count).toBe(2)
  })

  it("counts a confirmed subject-specific cause supplied by the backend", () => {
    const taxonomy: MistakeCauseSpec[] = [
      { cause: "physics:model-selection", label: "模型选择错误", reviewFixes: true, action: "重画受力图" },
    ]
    const summary = summarizeMistakes([record("physics:model-selection")], taxonomy)

    expect(summary.byCause).toEqual([
      expect.objectContaining({
        count: 1,
        spec: expect.objectContaining({ cause: "physics:model-selection", label: "模型选择错误" }),
      }),
    ])
    expect(summary.reviewFixable).toBe(1)
  })

  it("keeps an unknown free-text cause visible as a conservative fallback", () => {
    const summary = summarizeMistakes([record("not-yet-classified")], MISTAKE_CAUSES)

    expect(summary.byCause[0]?.spec.label).toContain("not-yet-classified")
    expect(summary.byCause[0]?.spec.reviewFixes).toBe(false)
    expect(summary.needsOtherFix).toBe(1)
  })
})

describe("filing a mistake", () => {
  const filed = { subject: "biology", question: "光合作用第 3 问", cause: "recall" } as const

  it("gives every record its own id, even two filed in the same breath", () => {
    // Ids now outlive the session they were made in, and a collision would let
    // one 删除 take a row you meant to keep.
    const a = createMistake(filed)
    const b = createMistake(filed)

    expect(a.id).not.toBe(b.id)
  })

  it("stamps the record with when it happened", () => {
    const stamped = createMistake(filed)

    expect(Number.isNaN(Date.parse(stamped.createdAt))).toBe(false)
  })

  it("survives its own round trip through storage", () => {
    // The guard: whatever createMistake builds has to be a shape readMistakes
    // will still accept, or the log empties itself on the next reload.
    writeMistakes([createMistake(filed)])

    expect(readMistakes()).toHaveLength(1)
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

  it("keeps a cause it no longer recognizes for later reclassification", () => {
    localStorage.setItem(
      mistakesStorageKey,
      JSON.stringify([{ ...record("recall", "a"), cause: "vibes" }, record("recall", "b")]),
    )

    expect(readMistakes()).toEqual([
      expect.objectContaining({ id: "a", cause: "vibes" }),
      record("recall", "b"),
    ])
  })

  it("keeps the stable question id when a server row is cached locally", () => {
    const cached = { ...record("method", "a"), questionId: "question-1" }
    localStorage.setItem(mistakesStorageKey, JSON.stringify([cached]))

    expect(readMistakes()).toEqual([cached])
  })
})

describe("what to do about a cause, by subject", () => {
  it("uses a persisted action for a new subject-specific cause", () => {
    const taxonomy: MistakeCauseSpec[] = [
      { cause: "physics:model-selection", label: "模型选择错误", reviewFixes: true, action: "重画受力图" },
    ]

    expect(causeActionFor("physics", "physics:model-selection", taxonomy)).toBe("重画受力图")
  })
  it("says something a physics student can actually go and do", () => {
    // 思路不对 in 物理 is nearly always the wrong model picked, and the fix is
    // a drawing, not more problems. The generic advice -- 找同类题再做两道 --
    // sends you to do more of the thing that just failed.
    const physics = causeActionFor("physics", "method")

    expect(physics).not.toBe(genericAction("method"))
    expect(physics).toContain("受力图")
  })

  it("uses the same tailored action defined by the six-subject prescription", () => {
    expect(causeActionFor("math", "careless")).toBe(guidanceFor("math", "careless")?.action)
    expect(causeActionFor("geography", "method")).toBe(guidanceFor("geography", "method")?.action)
  })

  it("falls back to the shared advice where a subject has nothing of its own", () => {
    // Only the causes that genuinely differ get a subject entry. Padding all
    // six for all six subjects would be 36 sentences nobody wrote and nobody
    // reads.
    expect(causeActionFor("physics", "time")).toBe(genericAction("time"))
  })

  it("gives the shared advice while no subject is chosen", () => {
    // 首页 sets 全部学科 by default, and the log then mixes subjects. Advice
    // naming 受力图 next to a 语文 row would be worse than none.
    expect(causeActionFor("all", "method")).toBe(genericAction("method"))
  })

  it("falls back rather than throwing on a subject it has never heard of", () => {
    // Subjects arrive from the database, which is older than this table and
    // will outlive it. An unknown id must cost you the tailored sentence, not
    // the row.
    expect(causeActionFor("astronomy", "method")).toBe(genericAction("method"))
  })

  it("keeps every tailored sentence pointing at a cause that still exists", () => {
    // The taxonomy is the single source of truth for which causes exist. A
    // subject entry naming a renamed cause would be dead text that no page can
    // ever reach, and nothing would say so.
    for (const subject of Object.keys(SUBJECT_CAUSE_ACTIONS)) {
      for (const cause of Object.keys(SUBJECT_CAUSE_ACTIONS[subject])) {
        expect(MISTAKE_CAUSES.some((spec) => spec.cause === cause)).toBe(true)
      }
    }
  })

  it("never promises review will fix something the taxonomy says it will not", () => {
    // The tailored sentence sits directly under a bar coloured by reviewFixes.
    // A 物理 sentence reading 排进复习 under an amber bar would contradict the
    // one invariant the whole page exists to state.
    for (const subject of Object.keys(SUBJECT_CAUSE_ACTIONS)) {
      for (const [cause, action] of Object.entries(SUBJECT_CAUSE_ACTIONS[subject])) {
        const spec = MISTAKE_CAUSES.find((entry) => entry.cause === cause)
        if (spec?.reviewFixes) continue
        expect(action).not.toContain("复习队列")
      }
    }
  })
})
