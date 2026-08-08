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

export function answerReview(
  promptId: string,
  answer: string,
  familiarity?: number,
): Promise<ReviewEvaluation> {
  return apiRequest<ReviewEvaluation>(`/reviews/${promptId}/answer`, {
    method: "POST",
    body: JSON.stringify({ answer, familiarity }),
  })
}

export function overrideAttempt(
  attemptId: string,
  rating: 1 | 2 | 3,
): Promise<ReviewEvaluation> {
  return apiRequest<ReviewEvaluation>(`/attempts/${attemptId}/override`, {
    method: "POST",
    body: JSON.stringify({ rating }),
  })
}

export function submitSelfRating(
  promptId: string,
  rating: 1 | 2 | 3,
): Promise<ReviewEvaluation> {
  return apiRequest<ReviewEvaluation>(`/reviews/${promptId}/answer`, {
    method: "POST",
    body: JSON.stringify({ self_rating: rating }),
  })
}
