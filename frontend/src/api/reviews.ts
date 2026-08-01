import { apiRequest } from "./client"
import type { DueReview, ReviewEvaluation } from "./types"

export function getDueReviews(limit = 20): Promise<{ items: DueReview[] }> {
  return apiRequest<{ items: DueReview[] }>(`/reviews/due?limit=${limit}`)
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
