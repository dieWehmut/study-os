import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReviewSession } from "./ReviewSession"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  answerReview: vi.fn(),
  getDueReviews: vi.fn(),
  overrideAttempt: vi.fn(),
}))

vi.mock("@/api/reviews", () => mocks)

describe("ReviewSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
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
    expect(await screen.findByText("已改判。")).toBeInTheDocument()
  })

  it("renders sentence prompts and hides an empty reference answer", async () => {
    mocks.getDueReviews.mockResolvedValueOnce({
      items: [
        {
          due_at: "2026-08-01T10:00:00Z",
          knowledge: { id: "k1", item_type: "word_sense" },
          prompt: {
            id: "p2",
            knowledge_item_id: "k1",
            prompt_type: "make_sentence",
            question: "用 abandon 造一个英文句子，并给出中文翻译。",
          },
        },
      ],
    })
    mocks.answerReview.mockResolvedValueOnce({
      attempt_id: "a2",
      outcome: "partial",
      rating: 2,
      feedback: "离线模式已记录你的答案。",
      due_at: "2026-08-02T10:00:00Z",
      expected_answers: [],
    })
    render(<ReviewSession />)

    expect(await screen.findByText("造句（AI 批改）")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "I abandon my old plan." } })
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))

    expect(await screen.findByText("离线模式已记录你的答案。")).toBeInTheDocument()
    expect(screen.queryByText(/参考答案/)).not.toBeInTheDocument()
  })

  it("offers four choices for cloze guessing and submits the picked word", async () => {
    mocks.getDueReviews.mockResolvedValueOnce({
      items: [
        {
          due_at: "2026-08-01T10:00:00Z",
          knowledge: { id: "k1", item_type: "word_sense" },
          prompt: {
            id: "p3",
            knowledge_item_id: "k1",
            prompt_type: "context_cloze",
            question: "They had to _____ the damaged car.",
            options: ["abandon", "resilient", "fluent", "serendipity"],
          },
        },
      ],
    })
    mocks.answerReview.mockResolvedValueOnce({
      attempt_id: "a3",
      outcome: "correct",
      rating: 3,
      feedback: "正确。",
      due_at: "2026-08-02T10:00:00Z",
      expected_answers: ["abandon"],
    })
    render(<ReviewSession />)

    expect(await screen.findByRole("button", { name: "abandon" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "resilient" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "fluent" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "serendipity" })).toBeInTheDocument()
    expect(screen.queryByLabelText("你的答案")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "abandon" }))
    await waitFor(() => expect(mocks.answerReview).toHaveBeenCalledWith("p3", "abandon", undefined))
    expect(await screen.findByText("正确。")).toBeInTheDocument()
  })

  it("loads reviews for the active subject and shows its badge", async () => {
    useSubjectStore.setState({ subject: "math" })
    render(<ReviewSession />)

    expect(await screen.findByText("数学")).toBeInTheDocument()
    await waitFor(() => expect(mocks.getDueReviews).toHaveBeenCalledWith(20, "math", undefined))
  })

  it("passes recovery mode to the due queue", async () => {
    render(<ReviewSession recovery />)

    await waitFor(() => expect(mocks.getDueReviews).toHaveBeenCalledWith(20, undefined, "recovery"))
  })
})
