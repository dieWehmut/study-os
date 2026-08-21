import type { MistakeRecord } from "@/lib/mistakes"

export type SubjectEvidenceTool =
  | "scoring_points"
  | "derivation"
  | "long_sentence"
  | "free_body"
  | "motion"
  | "equation"
  | "causal_chain"

export function subjectEvidenceToolFor(record: MistakeRecord): SubjectEvidenceTool | null {
  switch (`${record.subject.trim().toLowerCase()}/${record.cause.trim().toLowerCase()}`) {
    case "chinese/method": return "scoring_points"
    case "math/method": return "derivation"
    case "english/method": return "long_sentence"
    case "physics/method": return "free_body"
    case "physics/misread": return "motion"
    case "chemistry/careless": return "equation"
    case "geography/method": return "causal_chain"
    default: return null
  }
}
