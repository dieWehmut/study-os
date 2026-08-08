import { apiRequest } from "./client"
import { MISTAKE_CAUSES, type MistakeCause, type MistakeRecord } from "@/lib/mistakes"

/**
 * How the store answers: a 题目 and one 作答 on it, kept apart because the same
 * question gets attempted again after 订正.
 */
interface MistakePair {
  question: {
    id: string
    subject?: string
    stem: string
    created_at: string
  }
  attempt: {
    id: string
    question_id: string
    cause?: string
    note?: string
    occurred_at: string
  }
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
 * Returns null for a cause the taxonomy no longer names. Every count, badge and
 * bar looks the cause up in MISTAKE_CAUSES, so an unrecognised one renders
 * blank while still swelling the total -- worse than losing the row.
 */
function toRecord(pair: MistakePair): MistakeRecord | null {
  if (!MISTAKE_CAUSES.some((spec) => spec.cause === pair.attempt.cause)) return null

  const record: MistakeRecord = {
    id: pair.attempt.id,
    subject: pair.question.subject?.trim() || "all",
    question: pair.question.stem,
    cause: pair.attempt.cause as MistakeCause,
    createdAt: pair.attempt.occurred_at,
  }
  return pair.attempt.note?.trim() ? { ...record, note: pair.attempt.note } : record
}

export async function listMistakes(options: ListMistakesOptions = {}): Promise<MistakeRecord[]> {
  const params = new URLSearchParams()
  if (options.subject !== undefined) params.set("subject", options.subject)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const suffix = params.toString()
  const page = await apiRequest<MistakeListResponse>(`/mistakes${suffix ? `?${suffix}` : ""}`)
  return (page.items ?? []).flatMap((pair) => {
    const record = toRecord(pair)
    return record ? [record] : []
  })
}

export async function recordMistake(filed: {
  subject: string
  question: string
  cause: MistakeCause
  note?: string
}): Promise<MistakeRecord> {
  const pair = await apiRequest<MistakePair>("/mistakes", {
    method: "POST",
    body: JSON.stringify({
      subject: filed.subject,
      stem: filed.question,
      cause: filed.cause,
      note: filed.note ?? "",
    }),
  })
  const record = toRecord(pair)
  if (!record) throw new Error("服务端记下的错因无法识别")
  return record
}

/**
 * Delete by the attempt id -- a row on the page is one 作答, not the question.
 */
export function deleteMistake(attemptID: string): Promise<void> {
  return apiRequest<void>(`/mistakes/${encodeURIComponent(attemptID)}`, { method: "DELETE" })
}
