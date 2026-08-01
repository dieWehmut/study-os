import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReviewSession } from "./ReviewSession"

const mocks = vi.hoisted(() => ({
  answerReview: vi.fn(),
  getDueReviews: vi.fn(),
  overrideAttempt: vi.fn(),
}))

vi.mock("@/api/reviews", () => mocks)

describe("ReviewSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDueReviews.mockResolvedValue({
      items: [
        {
          due_at: "2026-08-01T10:00:00Z",
          knowledge: {
            id: "k1",
            item_type: "word_sense",
          },
          prompt: {
            id: "p1",
            knowledge_item_id: "k1",
            prompt_type: "en_to_zh",
            question: "abandon",
          },
        },
      ],
    })
    mocks.answerReview.mockResolvedValue({
      attempt_id: "a1",
      outcome: "correct",
      rating: 3,
      feedback: "正确。",
      due_at: "2026-08-02T10:00:00Z",
      expected_answers: ["放弃；抛弃"],
    })
    mocks.overrideAttempt.mockResolvedValue({
      attempt_id: "a1",
      outcome: "correct",
      rating: 2,
      feedback: "已改判。",
      due_at: "2026-08-01T11:00:00Z",
      expected_answers: ["放弃；抛弃"],
    })
  })

  it("loads a prompt, submits an answer, and lets the learner correct the rating", async () => {
    render(<ReviewSession />)

    expect(await screen.findByRole("heading", { name: "abandon" })).toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "放弃；抛弃" } })
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))

    expect(await screen.findByText("正确。")) .toBeInTheDocument()
    expect(mocks.answerReview).toHaveBeenCalledWith("p1", "放弃；抛弃", undefined)

    fireEvent.click(screen.getByRole("button", { name: "改判为较难" }))
    await waitFor(() => expect(mocks.overrideAttempt).toHaveBeenCalledWith("a1", 2))
    expect(await screen.findByText("已改判。")) .toBeInTheDocument()
  })
})
