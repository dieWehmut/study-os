import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DueReview } from "@/api/types"
import { RecognitionPrompt } from "./RecognitionPrompt"

const mocks = vi.hoisted(() => ({
  submitSelfRating: vi.fn(),
}))

vi.mock("@/api/reviews", () => mocks)

const current: DueReview = {
  due_at: "2026-08-01T10:00:00Z",
  knowledge: { id: "k1", item_type: "word_sense" },
  prompt: {
    id: "p1",
    knowledge_item_id: "k1",
    prompt_type: "en_to_zh",
    question: "abandon",
  },
}

describe("RecognitionPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.submitSelfRating.mockResolvedValue({
      attempt_id: "a1",
      outcome: "correct",
      rating: 3,
      feedback: "认识",
      due_at: "2026-08-05T10:00:00Z",
      expected_answers: ["放弃", "抛弃"],
    })
  })

  it.each<[string, 1 | 2 | 3]>([
    ["认识", 3],
    ["模糊", 2],
    ["不认识", 1],
  ])("submits %s as self-rating %i", async (label, rating) => {
    render(<RecognitionPrompt current={current} onNext={vi.fn()} onError={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: label }))

    await waitFor(() => expect(mocks.submitSelfRating).toHaveBeenCalledWith("p1", rating))
  })

  it("takes 1, 2 and 3 from the keyboard while a card is being rated", async () => {
    // Drilling is repetitive: reaching for the mouse on every card is the slow part.
    render(<RecognitionPrompt current={current} onNext={vi.fn()} onError={vi.fn()} />)

    fireEvent.keyDown(window, { key: "2" })

    await waitFor(() => expect(mocks.submitSelfRating).toHaveBeenCalledWith("p1", 2))
  })

  it("moves on with Enter once the answer is shown", async () => {
    const onNext = vi.fn()
    render(<RecognitionPrompt current={current} onNext={onNext} onError={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "认识" }))
    await screen.findByText("放弃 / 抛弃")

    fireEvent.keyDown(window, { key: "Enter" })

    expect(onNext).toHaveBeenCalled()
  })

  it("does not treat a keypress in a field as a rating", async () => {
    // A digit typed into something the reader is editing is text, not a verdict.
    render(<RecognitionPrompt current={current} onNext={vi.fn()} onError={vi.fn()} />)
    const field = document.createElement("input")
    document.body.append(field)

    fireEvent.keyDown(field, { key: "3" })

    expect(mocks.submitSelfRating).not.toHaveBeenCalled()
    field.remove()
  })

  it("reveals the expected answers after rating and offers the next card", async () => {
    const onNext = vi.fn()
    render(<RecognitionPrompt current={current} onNext={onNext} onError={vi.fn()} />)

    expect(screen.queryByText(/放弃/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "认识" }))

    expect(await screen.findByText("放弃 / 抛弃")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "模糊" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "下一题" }))
    expect(onNext).toHaveBeenCalled()
  })

  it("reports an error when the rating fails to save", async () => {
    const onError = vi.fn()
    mocks.submitSelfRating.mockRejectedValueOnce(new Error("offline"))
    render(<RecognitionPrompt current={current} onNext={vi.fn()} onError={onError} />)

    fireEvent.click(screen.getByRole("button", { name: "认识" }))

    await waitFor(() => expect(onError).toHaveBeenCalledWith("评分未能保存，请重试。"))
  })
})
