import { describe, expect, it } from "vitest"

import { SUBJECTS } from "./subjects"
import {
  guidanceFor,
  prescriptionFor,
  type SubjectEvidenceToolId,
} from "./subject-prescriptions"

const knownTools: SubjectEvidenceToolId[] = [
  "scoring_points",
  "derivation",
  "long_sentence",
  "free_body",
  "motion",
  "equation",
  "causal_chain",
]

describe("subject prescriptions", () => {
  it("gives every canonical subject a distinct actionable prescription", () => {
    const prescriptions = SUBJECTS.map(({ id }) => prescriptionFor(id))

    expect(prescriptions).not.toContain(undefined)
    const present = prescriptions.filter((item): item is NonNullable<typeof item> => Boolean(item))
    expect(new Set(present.map((item) => item.id)).size).toBe(SUBJECTS.length)
    expect(new Set(present.map((item) => item.focus)).size).toBe(SUBJECTS.length)

    for (const prescription of present) {
      expect(prescription.actions.length).toBeGreaterThanOrEqual(2)
      expect(prescription.actions.every((action) => action.trim().length > 0)).toBe(true)
      expect(prescription.evidence.trim().length).toBeGreaterThan(0)
      expect(prescription.nextStep.trim().length).toBeGreaterThan(0)
      expect(prescription.guidance.length).toBeGreaterThan(0)
      for (const guidance of prescription.guidance) {
        if (guidance.tool) expect(knownTools).toContain(guidance.tool)
      }
    }
  })

  it("keeps subject and cause guidance specific", () => {
    expect(guidanceFor("chinese", "method")).toMatchObject({ tool: "scoring_points" })
    expect(guidanceFor("math", "method")).toMatchObject({ tool: "derivation" })
    expect(guidanceFor("english", "method")).toMatchObject({ tool: "long_sentence" })
    expect(guidanceFor("physics", "method")).toMatchObject({ tool: "free_body" })
    expect(guidanceFor("physics", "misread")).toMatchObject({ tool: "motion" })
    expect(guidanceFor("chemistry", "careless")).toMatchObject({ tool: "equation" })
    expect(guidanceFor("geography", "method")).toMatchObject({ tool: "causal_chain" })

    expect(guidanceFor("physics", "method")?.action).not.toBe(
      guidanceFor("math", "method")?.action,
    )
    expect(guidanceFor("unknown", "method")).toBeUndefined()
    expect(prescriptionFor("unknown")).toBeUndefined()
  })
})
