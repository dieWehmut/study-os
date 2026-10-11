import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DueReview } from "@/api/types"
import { ProductionPrompt } from "./ProductionPrompt"

const mocks = vi.hoisted(() => ({
  answerReview: vi.fn(),
  overrideAttempt: vi.fn(),
}))

vi.mock("@/api/reviews", () => mocks)

function review(overrides: Partial<DueReview["prompt"]> = {}): DueReview {
  return {
    due_at: "2026-08-01T10:00:00Z",
    knowledge: { id: "k1", item_type: "word_sense" },
    prompt: {
      id: "p1",
      knowledge_item_id: "k1",
      prompt_type: "zh_to_en",
      question: "放弃",
      ...overrides,
    },
  }
}

const graded = {
  attempt_id: "a1",
  outcome: "correct" as const,
  rating: 3,
  feedback: "对了",
  due_at: "2026-08-05T10:00:00Z",
  expected_answers: ["abandon"],
}

describe("ProductionPrompt keyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.answerReview.mockResolvedValue(graded)
    mocks.overrideAttempt.mockResolvedValue({ ...graded, rating: 1, outcome: "incorrect" })
  })

  it("picks a choice with a number when the card offers options", async () => {
    render(<ProductionPrompt current={review({ prompt_type: "context_cloze", options: ["abandon", "keep"] })} onNext={vi.fn()} onError={vi.fn()} />)

    fireEvent.keyDown(window, { key: "2" })

    await waitFor(() => expect(mocks.answerReview).toHaveBeenCalledWith("p1", "keep", undefined))
  })

  it("uses the same three-way scale to 改判 after the verdict", async () => {
    render(<ProductionPrompt current={review()} onNext={vi.fn()} onError={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("你的答案"), { target: { value: "abandon" } })
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))
    await screen.findByText("对了")

    fireEvent.keyDown(window, { key: "1" })

    await waitFor(() => expect(mocks.overrideAttempt).toHaveBeenCalledWith("a1", 1))
  })

  it("moves on with Enter once the answer is shown", async () => {
    const onNext = vi.fn()
    render(<ProductionPrompt current={review()} onNext={onNext} onError={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("你的答案"), { target: { value: "abandon" } })
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))
    await screen.findByText("对了")

    fireEvent.keyDown(window, { key: "Enter" })

    expect(onNext).toHaveBeenCalled()
  })

  it("leaves a digit typed into the answer box alone", async () => {
    // There is no choice to make here, and the reader may be typing the number.
    render(<ProductionPrompt current={review()} onNext={vi.fn()} onError={vi.fn()} />)
    const field = screen.getByLabelText("你的答案")

    fireEvent.keyDown(field, { key: "2" })

    expect(mocks.answerReview).not.toHaveBeenCalled()
  })
})