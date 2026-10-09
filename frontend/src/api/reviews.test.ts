import { beforeEach, describe, expect, it, vi } from "vitest"

import { answerReview, overrideAttempt, submitSelfRating } from "./reviews"

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

const graded = {
  attempt_id: "attempt-1",
  outcome: "incorrect",
  rating: 1,
  feedback: "再看一遍公式的适用条件。",
  due_at: "2026-08-04T00:00:00Z",
}

describe("review answer responses", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reads a null reference-answer list as none instead of handing a crash inward", async () => {
    // A nil Go slice marshals as null, and 记忆 indexes this field -- answering a
    // 默写公式 card with no registered answer used to blank the entire app.
    mocks.apiRequest.mockResolvedValue({ ...graded, expected_answers: null })

    const evaluation = await answerReview("p-1", "合外力做的功等于动能变化")

    expect(evaluation.expected_answers).toEqual([])
  })

  it("keeps the reference answers the server did send", async () => {
    mocks.apiRequest.mockResolvedValue({ ...graded, outcome: "correct", rating: 3, expected_answers: ["放弃", "抛弃"] })

    const evaluation = await answerReview("p-1", "放弃")

    expect(evaluation.expected_answers).toEqual(["放弃", "抛弃"])
  })

  it("normalises an overridden verdict and a self-rating the same way", async () => {
    mocks.apiRequest.mockResolvedValue({ ...graded, expected_answers: null })

    expect((await overrideAttempt("attempt-1", 3)).expected_answers).toEqual([])
    expect((await submitSelfRating("p-1", 2)).expected_answers).toEqual([])
  })

  it("keeps every request on the path and body the server answers", async () => {
    // The normalisation must sit around the call, not in place of it.
    mocks.apiRequest.mockResolvedValue({ ...graded, expected_answers: [] })

    await answerReview("p-1", "放弃", 4)
    await overrideAttempt("attempt-1", 3)
    await submitSelfRating("p-1", 2)

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, "/reviews/p-1/answer", {
      method: "POST",
      body: JSON.stringify({ answer: "放弃", familiarity: 4 }),
    })
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, "/attempts/attempt-1/override", {
      method: "POST",
      body: JSON.stringify({ rating: 3 }),
    })
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(3, "/reviews/p-1/answer", {
      method: "POST",
      body: JSON.stringify({ self_rating: 2 }),
    })
  })
})