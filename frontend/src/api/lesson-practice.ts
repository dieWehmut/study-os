import { apiRequest } from "./client"

/** The deterministic result stored for one answer inside a lesson. */
export type LessonPracticeEvaluation = "correct" | "incorrect" | "ungraded"

export interface LessonPracticeAttempt {
  id: string
  lesson_id: string
  section_id: string
  answer: string
  evaluation: LessonPracticeEvaluation
  reference_answer: string
  feedback: string
  elapsed_ms: number
  created_at: string
}

export interface LessonPracticeAttemptListResponse {
  items: LessonPracticeAttempt[]
  count: number
}

export interface SubmitLessonPracticeAttemptInput {
  answer: string
  elapsedMs?: number
}

interface RawAttempt {
  id?: unknown
  attempt_id?: unknown
  lesson_id?: unknown
  section_id?: unknown
  answer?: unknown
  evaluation?: unknown
  reference_answer?: unknown
  feedback?: unknown
  elapsed_ms?: unknown
  created_at?: unknown
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function normalizeEvaluation(value: unknown): LessonPracticeEvaluation {
  return value === "correct" || value === "incorrect" || value === "ungraded" ? value : "ungraded"
}

/** Normalize the wire response so local and backend adapters expose one shape. */
export function normalizeLessonPracticeAttempt(value: unknown): LessonPracticeAttempt {
  const raw = value && typeof value === "object" ? value as RawAttempt : {}
  return {
    id: stringValue(raw.id) || stringValue(raw.attempt_id),
    lesson_id: stringValue(raw.lesson_id),
    section_id: stringValue(raw.section_id),
    answer: stringValue(raw.answer),
    evaluation: normalizeEvaluation(raw.evaluation),
    reference_answer: stringValue(raw.reference_answer),
    feedback: stringValue(raw.feedback),
    elapsed_ms: typeof raw.elapsed_ms === "number" && Number.isFinite(raw.elapsed_ms) ? raw.elapsed_ms : 0,
    created_at: stringValue(raw.created_at),
  }
}

function practicePath(lessonID: string, sectionID: string): string {
  return `/lessons/${encodeURIComponent(lessonID)}/practice/${encodeURIComponent(sectionID)}/attempts`
}

export async function submitLessonPracticeAttempt(
  lessonID: string,
  sectionID: string,
  input: SubmitLessonPracticeAttemptInput,
): Promise<LessonPracticeAttempt> {
  const result = await apiRequest<unknown>(practicePath(lessonID, sectionID), {
    method: "POST",
    body: JSON.stringify({ answer: input.answer, elapsed_ms: input.elapsedMs ?? 0 }),
  })
  return normalizeLessonPracticeAttempt(result)
}

export async function listLessonPracticeAttempts(
  lessonID: string,
  sectionID: string,
): Promise<LessonPracticeAttemptListResponse> {
  const result = await apiRequest<{ items?: unknown[]; count?: unknown }>(practicePath(lessonID, sectionID))
  const items = Array.isArray(result.items) ? result.items.map(normalizeLessonPracticeAttempt) : []
  return { items, count: typeof result.count === "number" ? result.count : items.length }
}
