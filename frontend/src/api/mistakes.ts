import { apiRequest } from "./client"
import type { MistakeCause, MistakeRecord } from "@/lib/mistakes"

/**
 * How the store answers: a 题目 and one 作答 on it, kept apart because the same
 * question gets attempted again after 订正.
 */
interface MistakePair {
  question: {
    id: string
    subject?: string
    stem: string
    knowledge_item_id?: string
    created_at: string
  }
  attempt: {
    id: string
    question_id: string
    cause?: string
    note?: string
    occurred_at: string
  }
  correction?: {
    id: string
    question_id: string
    answer?: string
    elapsed_ms?: number
    is_correct?: boolean
    occurred_at: string
  }
  /** The question has since been answered right. Derived server-side. */
  corrected?: boolean
}

interface MistakeListResponse {
  items: MistakePair[]
  count: number
}

export interface ListMistakesOptions {
  subject?: string
  limit?: number
}

/**
 * Flatten one server pair into the row the page draws.
 *
 * Keep a free-text cause visible even when the current taxonomy does not name
 * it yet. The learner can reclassify it once a confirmed category exists.
 */
function toRecord(pair: MistakePair): MistakeRecord {
  const record: MistakeRecord = {
    id: pair.attempt.id,
    subject: pair.question.subject?.trim() || "all",
    question: pair.question.stem,
    cause: pair.attempt.cause?.trim() || "unknown",
    createdAt: pair.attempt.occurred_at,
  }
  // An absent link reads as "not queued". The other way round would lock the
  // button on every row against a backend that predates the column.
  const linked = pair.question.knowledge_item_id?.trim()
    ? { ...record, knowledgeItemId: pair.question.knowledge_item_id }
    : record
  const noted = pair.attempt.note?.trim() ? { ...linked, note: pair.attempt.note } : linked
  // Likewise absent: an older backend answers nothing, and "not yet fixed" is
  // the reading that leaves 订正 pressable instead of hiding it everywhere.
  const corrected = pair.corrected || pair.correction?.is_correct === true
  if (!corrected) return noted
  const correctionAnswer = pair.correction?.answer?.trim()
  const correction = correctionAnswer && pair.correction
    ? {
        answer: correctionAnswer,
        elapsedMs: Math.max(0, Math.trunc(pair.correction.elapsed_ms ?? 0)),
        occurredAt: pair.correction.occurred_at,
      }
    : undefined
  return correction ? { ...noted, corrected: true, correction } : { ...noted, corrected: true }
}

export async function listMistakes(options: ListMistakesOptions = {}): Promise<MistakeRecord[]> {
  const params = new URLSearchParams()
  if (options.subject !== undefined) params.set("subject", options.subject)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const suffix = params.toString()
  const page = await apiRequest<MistakeListResponse>(`/mistakes${suffix ? `?${suffix}` : ""}`)
  return (page.items ?? []).map(toRecord)
}

export async function recordMistake(filed: {
  subject: string
  question: string
  cause: MistakeCause
  note?: string
  answer?: string
  elapsedMs?: number
}): Promise<MistakeRecord> {
  const pair = await apiRequest<MistakePair>("/mistakes", {
    method: "POST",
    body: JSON.stringify({
      subject: filed.subject,
      stem: filed.question,
      cause: filed.cause,
      note: filed.note ?? "",
      ...(filed.answer?.trim() ? { answer: filed.answer.trim() } : {}),
      ...(filed.elapsedMs !== undefined ? { elapsed_ms: filed.elapsedMs } : {}),
    }),
  })
  return toRecord(pair)
}

/**
 * Delete by the attempt id -- a row on the page is one 作答, not the question.
 */
export function deleteMistake(attemptID: string): Promise<void> {
  return apiRequest<void>(`/mistakes/${encodeURIComponent(attemptID)}`, { method: "DELETE" })
}

/**
 * Put one 想不起来 错题 back in the spaced-review queue.
 *
 * Hands back the library entry the question became, which is the same link the
 * list carries -- so the page can stop offering the button without refetching.
 * The server refuses a cause more review cannot fix; the page only offers the
 * button where the taxonomy agrees, and a 400 is the backstop for the two
 * copies disagreeing.
 */
export async function scheduleMistake(attemptID: string): Promise<string> {
  const scheduled = await apiRequest<{ knowledge_id: string }>(
    `/mistakes/${encodeURIComponent(attemptID)}/schedule`,
    { method: "POST" },
  )
  return scheduled.knowledge_id
}

/**
 * Mark one filed mistake as one you have since got right.
 *
 * Deliberately not deleteMistake. 取消 is for a row filed by accident; 订正 is
 * for a mistake you fixed, and the row has to stay -- "I got this wrong once
 * and put it right" is the sentence the log exists to be able to say. The
 * answer comes back still a mistake, carrying the mark.
 */
export async function correctMistake(attemptID: string, evidence: { answer: string; elapsedMs: number }): Promise<MistakeRecord> {
  const pair = await apiRequest<MistakePair>(
    `/mistakes/${encodeURIComponent(attemptID)}/correct`,
    {
      method: "POST",
      body: JSON.stringify({ answer: evidence.answer.trim(), elapsed_ms: evidence.elapsedMs }),
    },
  )
  return toRecord(pair)
}

export async function reclassifyMistake(attemptID: string, cause: MistakeCause): Promise<MistakeRecord> {
  const pair = await apiRequest<MistakePair>(
    `/mistakes/${encodeURIComponent(attemptID)}/cause`,
    { method: "PATCH", body: JSON.stringify({ cause }) },
  )
  return toRecord(pair)
}
