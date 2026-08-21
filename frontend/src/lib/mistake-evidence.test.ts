import { describe, expect, it } from "vitest"

import { normalizeSubjectAttemptEvidence } from "./mistake-evidence"

describe("subject attempt evidence", () => {
  it.each([
    ["chinese", "scoring_points", { points: ["借景抒情"], answer: "借景抒情表达思乡" }],
    ["math", "derivation", { lines: ["2x+4=10", "2x=6", "x=3"] }],
    ["english", "long_sentence", { sentence: "The book that I bought is useful." }],
    ["physics", "free_body", { forces: [{ id: "gravity-0", name: "重力", magnitude: 10, angle: 270, kind: "field" }] }],
    ["physics", "motion", { stages: [{ id: "accelerate-0", name: "加速", v0: 0, v: 10, a: 2, t: 5, x: 25, derived: ["v", "x"] }] }],
    ["chemistry", "equation", { equation: "2H2 + O2 = 2H2O" }],
    ["geography", "causal_chain", { links: [{ cause: "城市化", effect: "下垫面硬化" }] }],
  ] as const)("accepts %s/%s evidence", (subject, tool, data) => {
    expect(normalizeSubjectAttemptEvidence(subject, { version: 1, subject, tool, data })).toEqual({
      version: 1,
      subject,
      tool,
      data,
    })
  })

  it.each([undefined, null, {}])("treats %j as no evidence", (value) => {
    expect(normalizeSubjectAttemptEvidence("math", value)).toBeUndefined()
  })

  it("accepts null motion quantities just like the Go contract", () => {
    expect(normalizeSubjectAttemptEvidence("physics", {
      version: 1,
      subject: "physics",
      tool: "motion",
      data: {
        stages: [{
          id: "coast-0",
          name: "coast",
          v0: 5,
          v: null,
          a: null,
          t: 2,
          x: null,
          derived: [],
        }],
      },
    })).toMatchObject({ tool: "motion" })
  })

  it.each([
    ["math", { version: 1, subject: "physics", tool: "free_body", data: { forces: [] } }],
    ["chinese", { version: 1, subject: "chinese", tool: "equation", data: { equation: "H2" } }],
    ["math", { version: 2, subject: "math", tool: "derivation", data: { lines: ["x=1", "x=1"] } }],
    ["math", { version: 1, subject: "math", tool: "derivation", data: { lines: ["x=1"] } }],
    ["physics", { version: 1, subject: "physics", tool: "free_body", data: { forces: [{ id: "g", name: "重力", magnitude: -1, angle: 270, kind: "field" }] } }],
    ["physics", { version: 1, subject: "physics", tool: "motion", data: { stages: [{ id: "s", name: "加速", t: -1 }] } }],
    ["chemistry", { version: 1, subject: "chemistry", tool: "equation", data: { equation: " " } }],
    ["geography", { version: 1, subject: "geography", tool: "causal_chain", data: { links: [{ cause: "城市化", effect: " " }] } }],
    ["math", { version: 1, subject: "math", tool: "derivation", data: { lines: ["x=1", "x=1"], extra: true } }],
    ["chemistry", { version: 1, subject: "chemistry", tool: "equation", data: { equation: "H2", extra: true } }],
    ["math", { version: 1, subject: "math", tool: "derivation", data: { lines: ["x=1", "x=1" ] }, extra: true }],
  ])("rejects evidence that does not satisfy %s", (subject, value) => {
    expect(() => normalizeSubjectAttemptEvidence(subject, value)).toThrow(/evidence/i)
  })
})
