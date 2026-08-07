import { apiRequest } from "./client"
import type { DueReview, ReviewEvaluation } from "./types"

export function getDueReviews(limit = 20, subject?: string, mode?: string): Promise<{ items: DueReview[] }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (subject) params.set("subject", subject)
  if (mode) params.set("mode", mode)
  return apiRequest<{ items: DueReview[] }>(`/reviews/due?${params.toString()}`)
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
