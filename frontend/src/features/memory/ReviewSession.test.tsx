import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReviewSession } from "./ReviewSession"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  answerReview: vi.fn(),
  getDueReviews: vi.fn(),
  overrideAttempt: vi.fn(),
  submitSelfRating: vi.fn(),
}))

const knowledgeMocks = vi.hoisted(() => ({
  listKnowledge: vi.fn(),
}))

vi.mock("@/api/reviews", () => mocks)
vi.mock("@/api/knowledge", () => knowledgeMocks)

function renderSession(props: { recovery?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <ReviewSession {...props} />
    </MemoryRouter>,
  )
}

describe("ReviewSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    knowledgeMocks.listKnowledge.mockResolvedValue({ items: [{ id: "k1" }], count: 1 })
    mocks.getDueReviews.mockResolvedValue({
      items: [
        {
          due_at: "2026-08-01T10:00:00Z",
          knowledge: { id: "k1", item_type: "word_sense" },
          prompt: {
            id: "p1",
            knowledge_item_id: "k1",
            prompt_type: "en_to_zh",
            question: "abandon",
          },
        },
      ],
    })
    mocks.submitSelfRating.mockResolvedValue({
      attempt_id: "a1",
      outcome: "correct",
      rating: 3,
      feedback: "认识",
      due_at: "2026-08-05T10:00:00Z",
      expected_answers: ["放弃；抛弃"],
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

  it("renders en_to_zh as a self-graded recognition card", async () => {
    renderSession()

    expect(await screen.findByRole("heading", { name: "abandon" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "认识" })).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "认识" }))

    await waitFor(() => expect(mocks.submitSelfRating).toHaveBeenCalledWith("p1", 3))
    expect(await screen.findByText("放弃；抛弃")).toBeInTheDocument()
  })

  it("renders zh_to_en as a typed production card and allows an override", async () => {
    mocks.getDueReviews.mockResolvedValueOnce({
      items: [
        {
          due_at: "2026-08-01T10:00:00Z",
          knowledge: { id: "k1", item_type: "word_sense" },
          prompt: {
            id: "p2",
            knowledge_item_id: "k1",
            prompt_type: "zh_to_en",
            question: "放弃；抛弃",
          },
        },
      ],
    })
    renderSession()

    expect(await screen.findByText("看中文，说英文")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "abandon" } })
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))

    expect(await screen.findByText("正确。")).toBeInTheDocument()
    expect(mocks.answerReview).toHaveBeenCalledWith("p2", "abandon", undefined)

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
            id: "p3",
            knowledge_item_id: "k1",
            prompt_type: "make_sentence",
            question: "用 abandon 造一个英文句子，并给出中文翻译。",
          },
        },
      ],
    })
    mocks.answerReview.mockResolvedValueOnce({
      attempt_id: "a3",
      outcome: "partial",
      rating: 2,
      feedback: "离线模式已记录你的答案。",
      due_at: "2026-08-02T10:00:00Z",
      expected_answers: [],
    })
    renderSession()

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
            id: "p4",
            knowledge_item_id: "k1",
            prompt_type: "context_cloze",
            question: "They had to _____ the damaged car.",
            options: ["abandon", "resilient", "fluent", "serendipity"],
          },
        },
      ],
    })
    mocks.answerReview.mockResolvedValueOnce({
      attempt_id: "a4",
      outcome: "correct",
      rating: 3,
      feedback: "正确。",
      due_at: "2026-08-02T10:00:00Z",
      expected_answers: ["abandon"],
    })
    renderSession()

    expect(await screen.findByRole("button", { name: "abandon" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "resilient" })).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "abandon" }))
    await waitFor(() => expect(mocks.answerReview).toHaveBeenCalledWith("p4", "abandon", undefined))
    expect(await screen.findByText("正确。")).toBeInTheDocument()
  })

  it("points at the import page when the subject library is empty", async () => {
    knowledgeMocks.listKnowledge.mockResolvedValueOnce({ items: [], count: 0 })
    mocks.getDueReviews.mockResolvedValueOnce({ items: [] })
    renderSession()

    expect(await screen.findByText("这个科目还没有任何内容")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "去导入" })).toHaveAttribute("href", "/import")
  })

  it("shows the completion card when the library has items but nothing is due", async () => {
    mocks.getDueReviews.mockResolvedValueOnce({ items: [] })
    renderSession()

    expect(await screen.findByText("今天的到期内容已经完成")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "去导入" })).not.toBeInTheDocument()
  })

  it("loads reviews and the library for the active subject", async () => {
    useSubjectStore.setState({ subject: "math" })
    renderSession()

    expect(await screen.findByText("数学")).toBeInTheDocument()
    await waitFor(() => expect(mocks.getDueReviews).toHaveBeenCalledWith(20, "math", undefined))
    expect(knowledgeMocks.listKnowledge).toHaveBeenCalledWith({ subject: "math", limit: 1 })
  })

  it("passes recovery mode to the due queue", async () => {
    renderSession({ recovery: true })

    await waitFor(() => expect(mocks.getDueReviews).toHaveBeenCalledWith(20, undefined, "recovery"))
  })
})
