import { apiRequest } from "./client"
import type { DueReview, ReviewEvaluation } from "./types"

export function getDueReviews(limit = 20, subject?: string, mode?: string): Promise<{ items: DueReview[] }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (subject) params.set("subject", subject)
  if (mode) params.set("mode", mode)
  return apiRequest<{ items: DueReview[] }>(`/reviews/due?${params.toString()}`)
}

export interface ForecastDay {
  date: string
  count: number
}

/**
 * How many cards each of the next `days` days is holding, today first.
 *
 * Days are calendar days on the learner's own clock, decided by the backend --
 * it runs on their machine. The client must not re-bucket them.
 */
export function getReviewForecast(
  days = 7,
  subject?: string,
): Promise<{ days: ForecastDay[]; horizon: number }> {
  const params = new URLSearchParams({ days: String(days) })
  if (subject) params.set("subject", subject)
  return apiRequest<{ days: ForecastDay[]; horizon: number }>(
    `/reviews/forecast?${params.toString()}`,
  )
}

/**
 * The wire can say `null` where the type says list.
 *
 * A backend that marshals a nil Go slice sends `null` for `expected_answers`,
 * and the 记忆 panels index that field -- a card with no reference answers
 * (默写公式, 造句, 上下句背诵) used to blank the whole app when answered.
 * `listRelatedKnowledge` set the precedent: a missing list has to read as
 * "none" at the boundary, not travel inward as a crash waiting to happen.
 */
type AnswerPayload = Omit<ReviewEvaluation, "expected_answers"> & {
  expected_answers?: string[] | null
}

function withExpectedAnswers(evaluation: AnswerPayload): ReviewEvaluation {
  return { ...evaluation, expected_answers: evaluation.expected_answers ?? [] }
}

export async function answerReview(
  promptId: string,
  answer: string,
  familiarity?: number,
): Promise<ReviewEvaluation> {
  const evaluation = await apiRequest<AnswerPayload>(`/reviews/${promptId}/answer`, {
    method: "POST",
    body: JSON.stringify({ answer, familiarity }),
  })
  return withExpectedAnswers(evaluation)
}

export async function overrideAttempt(
  attemptId: string,
  rating: 1 | 2 | 3,
): Promise<ReviewEvaluation> {
  const evaluation = await apiRequest<AnswerPayload>(`/attempts/${attemptId}/override`, {
    method: "POST",
    body: JSON.stringify({ rating }),
  })
  return withExpectedAnswers(evaluation)
}

export async function submitSelfRating(
  promptId: string,
  rating: 1 | 2 | 3,
): Promise<ReviewEvaluation> {
  const evaluation = await apiRequest<AnswerPayload>(`/reviews/${promptId}/answer`, {
    method: "POST",
    body: JSON.stringify({ self_rating: rating }),
  })
  return withExpectedAnswers(evaluation)
}
