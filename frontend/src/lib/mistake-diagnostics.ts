import { subjectName } from "./subjects"
import {
  causeActionFor,
  causeSpecFor,
  MISTAKE_CAUSES,
  type MistakeCauseSpec,
  type MistakeRecord,
} from "./mistakes"
import { normalizeSubjectAttemptEvidence } from "./mistake-evidence"
import { subjectEvidenceToolFor } from "@/features/mistake/subject-evidence"

/**
 * The dashboard is deliberately ordered like the subject picker. Keeping the
 * order here means an empty log still has a predictable six-row shape.
 */
export const SUBJECT_DIAGNOSTIC_ORDER = [
  "chinese",
  "math",
  "english",
  "physics",
  "chemistry",
  "geography",
] as const

export type SubjectDiagnosticId = (typeof SUBJECT_DIAGNOSTIC_ORDER)[number]

export interface SubjectDiagnosticSummary {
  /** Canonical subject id for a built-in row; kept as string for view adapters. */
  subject: string
  label: string
  total: number
  corrected: number
  /** Rows for which a cause has a dedicated, executable evidence tool. */
  evidenceTotal: number
  /** Rows whose evidence is valid and uses that row's dedicated tool. */
  evidenceCompleted: number
  /** Number of rows for which the learner can open a dedicated tool. */
  toolReadyCount: number
  topCause: string | null
  topCauseLabel: string | null
  action: string | null
}

function canonicalSubject(value: string): string {
  return value.trim().toLowerCase()
}

function causeOrder(taxonomy: MistakeCauseSpec[]): Map<string, number> {
  return new Map(taxonomy.map((spec, index) => [spec.cause, index]))
}

/**
 * Evidence is complete only when it is valid for the row's subject *and* is
 * the tool selected by its subject/cause pair. A valid chemistry equation on
 * a recall row, for example, is useful data but does not satisfy that row's
 * missing dedicated tool (recall has no equation board).
 */
function hasMatchingEvidence(record: MistakeRecord): boolean {
  const expectedTool = subjectEvidenceToolFor(record)
  if (!expectedTool || !record.evidence) return false

  try {
    const normalized = normalizeSubjectAttemptEvidence(record.subject, record.evidence)
    return normalized?.tool === expectedTool
  } catch {
    // Rows can come from an older server or a newer client. A malformed
    // artifact must not make the whole six-subject dashboard disappear.
    return false
  }
}

function topCauseFor(
  records: MistakeRecord[],
  taxonomy: MistakeCauseSpec[],
): string | null {
  if (records.length === 0) return null

  const counts = new Map<string, number>()
  for (const record of records) {
    counts.set(record.cause, (counts.get(record.cause) ?? 0) + 1)
  }
  const order = causeOrder(taxonomy)
  return [...counts.entries()]
    .sort(([causeA, countA], [causeB, countB]) => {
      if (countA !== countB) return countB - countA
      const orderA = order.get(causeA)
      const orderB = order.get(causeB)
      // Unknown causes are still shown, but sort deterministically after the
      // known taxonomy instead of depending on insertion order from the API.
      if (orderA !== undefined || orderB !== undefined) {
        return (orderA ?? Number.MAX_SAFE_INTEGER) - (orderB ?? Number.MAX_SAFE_INTEGER)
      }
      return causeA.localeCompare(causeB)
    })
    .map(([cause]) => cause)[0] ?? null
}

/**
 * Aggregate the mistake log into one stable diagnostic row per core subject.
 * Unknown subject ids are ignored rather than coerced into a real subject;
 * this preserves trustworthy totals while remaining forward-compatible with
 * records written by a newer server.
 */
export function summarizeMistakeDiagnostics(
  records: MistakeRecord[],
  taxonomy: MistakeCauseSpec[] = MISTAKE_CAUSES,
): SubjectDiagnosticSummary[] {
  return SUBJECT_DIAGNOSTIC_ORDER.map((subject) => {
    const subjectRecords = records.filter((record) => canonicalSubject(record.subject) === subject)
    const toolReadyCount = subjectRecords.reduce(
      (count, record) => count + (subjectEvidenceToolFor(record) ? 1 : 0),
      0,
    )
    const evidenceCompleted = subjectRecords.reduce(
      (count, record) => count + (hasMatchingEvidence(record) ? 1 : 0),
      0,
    )
    const topCause = topCauseFor(subjectRecords, taxonomy)
    const topSpec = topCause ? causeSpecFor(topCause, taxonomy) : null

    return {
      subject,
      label: subjectName(subject),
      total: subjectRecords.length,
      corrected: subjectRecords.reduce((count, record) => count + (record.corrected ? 1 : 0), 0),
      evidenceTotal: toolReadyCount,
      evidenceCompleted,
      toolReadyCount,
      topCause,
      topCauseLabel: topSpec?.label ?? null,
      action: topCause ? causeActionFor(subject, topCause, taxonomy) : null,
    }
  })
}

/** Alias with a builder-style name for callers that prefer data-layer verbs. */
export const buildMistakeDiagnostics = summarizeMistakeDiagnostics
