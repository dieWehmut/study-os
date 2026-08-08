import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Memory from "./Memory"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getDueReviews: vi.fn(),
  answerReview: vi.fn(),
  overrideAttempt: vi.fn(),
  submitSelfRating: vi.fn(),
  listKnowledge: vi.fn(),
}))

vi.mock("@/api/dashboard", () => ({ getDashboard: mocks.getDashboard }))
vi.mock("@/api/reviews", () => ({
  getDueReviews: mocks.getDueReviews,
  answerReview: mocks.answerReview,
  overrideAttempt: mocks.overrideAttempt,
  submitSelfRating: mocks.submitSelfRating,
}))
vi.mock("@/api/knowledge", () => ({ listKnowledge: mocks.listKnowledge }))

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    knowledge_count: 40,
    prompt_count: 40,
    due_count: 3,
    attempt_count: 0,
    reviewed_today: 2,
    current_streak: 4,
    provider: "mock",
    offline: true,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Memory />
    </MemoryRouter>,
  )
}

describe("Memory page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    mocks.getDashboard.mockResolvedValue(dashboard())
    mocks.getDueReviews.mockResolvedValue({ items: [], count: 0 })
    mocks.listKnowledge.mockResolvedValue({ items: [], count: 0 })
  })

  it("counts what is due and what is done", async () => {
    renderPage()

    expect(await screen.findByText("待复习")).toBeInTheDocument()
    expect(screen.getByText("今日已复习")).toBeInTheDocument()
  })

  it("shows how far through today's queue you are", async () => {
    // Two counts make you hold both numbers and divide to answer "am I nearly
    // done?" -- the one question that decides whether you keep going.
    renderPage()

    const bar = await screen.findByRole("progressbar", { name: "今日进度" })
    expect(bar).toHaveAttribute("aria-valuenow", "40")
  })

  it("says the fraction in words too, for anyone reading it aloud", async () => {
    renderPage()

    expect(await screen.findByText("2 / 5")).toBeInTheDocument()
  })

  it("reaches the end of the bar when the queue is empty", async () => {
    mocks.getDashboard.mockResolvedValue(dashboard({ due_count: 0, reviewed_today: 5 }))
    renderPage()

    const bar = await screen.findByRole("progressbar", { name: "今日进度" })
    expect(bar).toHaveAttribute("aria-valuenow", "100")
  })

  it("offers no finish line when nothing was scheduled", async () => {
    // A 0/0 bar sitting at full would read as "done" on a day that never had
    // anything to do.
    mocks.getDashboard.mockResolvedValue(dashboard({ due_count: 0, reviewed_today: 0 }))
    renderPage()

    await waitFor(() => expect(mocks.getDashboard).toHaveBeenCalled())
    expect(screen.queryByRole("progressbar", { name: "今日进度" })).not.toBeInTheDocument()
  })
})
