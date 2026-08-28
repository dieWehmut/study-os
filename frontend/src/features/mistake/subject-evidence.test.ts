import { describe, expect, it } from "vitest"

import type { MistakeRecord } from "@/lib/mistakes"

import { subjectEvidenceToolFor } from "./subject-evidence"

function record(subject: string, cause: string): MistakeRecord {
  return {
    id: `${subject}-${cause}`,
    subject,
    cause,
    question: "test",
    createdAt: "2026-08-28T00:00:00Z",
  }
}

describe("subject evidence routing", () => {
  it("uses the derivation board for both math method errors and skipped-step carelessness", () => {
    expect(subjectEvidenceToolFor(record("math", "method"))).toBe("derivation")
    expect(subjectEvidenceToolFor(record("math", "careless"))).toBe("derivation")
  })

  it("keeps the existing subject-specific tools and leaves generic causes alone", () => {
    expect(subjectEvidenceToolFor(record("physics", "method"))).toBe("free_body")
    expect(subjectEvidenceToolFor(record("geography", "method"))).toBe("causal_chain")
    expect(subjectEvidenceToolFor(record("english", "time"))).toBeNull()
  })
})
