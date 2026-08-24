import { describe, expect, it } from "vitest"

import type { MistakeRecord } from "./mistakes"
import {
  SUBJECT_DIAGNOSTIC_ORDER,
  summarizeMistakeDiagnostics,
} from "./mistake-diagnostics"

const NOW = "2026-08-24T00:00:00.000Z"

function record(overrides: Partial<MistakeRecord> = {}): MistakeRecord {
  return {
    id: overrides.id ?? "mistake",
    subject: overrides.subject ?? "math",
    question: overrides.question ?? "sample question",
    cause: overrides.cause ?? "method",
    createdAt: overrides.createdAt ?? NOW,
    ...overrides,
  }
}

describe("mistake diagnostics", () => {
  it("returns all six subjects in a stable order, including empty subjects", () => {
    const summaries = summarizeMistakeDiagnostics([])

    expect(summaries.map((summary) => summary.subject)).toEqual([...SUBJECT_DIAGNOSTIC_ORDER])
    expect(summaries.map((summary) => summary.label)).toEqual([
      "语文",
      "数学",
      "英语",
      "物理",
      "化学",
      "地理",
    ])
    expect(summaries.every((summary) => summary.total === 0)).toBe(true)
    expect(summaries.every((summary) => summary.corrected === 0)).toBe(true)
    expect(summaries.every((summary) => summary.evidenceTotal === 0)).toBe(true)
    expect(summaries.every((summary) => summary.evidenceCompleted === 0)).toBe(true)
    expect(summaries.every((summary) => summary.toolReadyCount === 0)).toBe(true)
    expect(summaries.every((summary) => summary.topCause === null && summary.action === null)).toBe(true)
  })

  it("groups each subject, ranks causes, and reports corrected and tool coverage", () => {
    const summaries = summarizeMistakeDiagnostics([
      record({
        id: "math-1",
        subject: "math",
        cause: "method",
        evidence: { version: 1, subject: "math", tool: "derivation", data: { lines: ["x = 1", "x = 2"] } },
      }),
      record({ id: "math-2", subject: "math", cause: "method", corrected: true }),
      record({ id: "math-3", subject: "math", cause: "careless" }),
      record({ id: "physics-1", subject: " Physics ", cause: "method" }),
      record({ id: "english-1", subject: "english", cause: "recall", corrected: true }),
    ])

    const math = summaries.find((summary) => summary.subject === "math")
    expect(math).toMatchObject({
      total: 3,
      corrected: 1,
      evidenceTotal: 2,
      evidenceCompleted: 1,
      toolReadyCount: 2,
      topCause: "method",
      topCauseLabel: "思路不对",
    })
    expect(math?.action).toContain("定位到出错的那一步")

    const physics = summaries.find((summary) => summary.subject === "physics")
    expect(physics).toMatchObject({ total: 1, topCause: "method", toolReadyCount: 1 })

    const english = summaries.find((summary) => summary.subject === "english")
    expect(english).toMatchObject({ total: 1, corrected: 1, topCause: "recall" })
  })

  it("uses taxonomy order for tied causes instead of input order", () => {
    const summaries = summarizeMistakeDiagnostics([
      record({ id: "careless", subject: "chemistry", cause: "careless" }),
      record({ id: "method", subject: "chemistry", cause: "method" }),
    ])

    expect(summaries.find((summary) => summary.subject === "chemistry")?.topCause).toBe("careless")
  })

  it("does not count a row without a matching dedicated tool as incomplete evidence", () => {
    const summaries = summarizeMistakeDiagnostics([
      record({
        subject: "chemistry",
        cause: "recall",
        evidence: { version: 1, subject: "chemistry", tool: "equation", data: { equation: "H2 + O2" } },
      }),
      record({ subject: "chemistry", cause: "careless" }),
    ])

    expect(summaries.find((summary) => summary.subject === "chemistry")).toMatchObject({
      total: 2,
      evidenceTotal: 1,
      evidenceCompleted: 0,
      toolReadyCount: 1,
    })
  })

  it("ignores malformed evidence and unknown subjects without throwing", () => {
    const summaries = summarizeMistakeDiagnostics([
      record({ subject: "astronomy", cause: "method" }),
      record({
        subject: "geography",
        cause: "method",
        evidence: { version: 1, subject: "geography", tool: "causal_chain", data: { links: [{ cause: "only" }] } } as never,
      }),
    ])

    expect(summaries).toHaveLength(6)
    expect(summaries.find((summary) => (summary.subject as string) === "astronomy")).toBeUndefined()
    expect(summaries.find((summary) => summary.subject === "geography")).toMatchObject({
      total: 1,
      evidenceTotal: 1,
      evidenceCompleted: 0,
    })
  })

  it("keeps unknown causes visible with a fallback label and action", () => {
    const summary = summarizeMistakeDiagnostics([
      record({ subject: "chinese", cause: "new-cause" }),
    ])[0]

    expect(summary).toMatchObject({
      topCause: "new-cause",
      topCauseLabel: "未分类：new-cause",
    })
    expect(summary.action).toContain("暂未归类")
  })
})
