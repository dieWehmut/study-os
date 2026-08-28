import type { MistakeRecord } from "@/lib/mistakes"
import { guidanceFor, type SubjectEvidenceToolId } from "@/lib/subject-prescriptions"

export type SubjectEvidenceTool = SubjectEvidenceToolId

export function subjectEvidenceToolFor(record: MistakeRecord): SubjectEvidenceTool | null {
  const guidance = guidanceFor(record.subject, record.cause)
  return guidance?.tool ?? null
}
