import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Memory from "./Memory"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getDueReviews: vi.fn(),
  getReviewForecast: vi.fn(),
  answerReview: vi.fn(),
  overrideAttempt: vi.fn(),
  submitSelfRating: vi.fn(),
  listKnowledge: vi.fn(),
}))

vi.mock("@/api/dashboard", () => ({ getDashboard: mocks.getDashboard }))
vi.mock("@/api/reviews", () => ({
  getDueReviews: mocks.getDueReviews,
  getReviewForecast: mocks.getReviewForecast,
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

function forecast(counts: number[], start = "2026-08-09") {
  const from = new Date(`${start}T00:00:00Z`)
  return {
    horizon: counts.length,
    days: counts.map((count, index) => {
      const day = new Date(from)
      day.setUTCDate(day.getUTCDate() + index)
      return { date: day.toISOString().slice(0, 10), count }
    }),
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
    mocks.getReviewForecast.mockResolvedValue(forecast([4, 9, 2, 0, 6, 1, 3]))
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

  it("shows what the coming week will ask of you, not just today", async () => {
    // 待复习 is one number, and one number cannot show a pile-up. Skipping
    // today is invisible until the day it all lands on arrives.
    renderPage()

    expect(await screen.findByText("接下来七天")).toBeInTheDocument()
    expect(screen.getByText(/最多的一天 9 张/)).toBeInTheDocument()
  })

  it("keeps today's queue above the week ahead", async () => {
    // The forecast is context for the work, not the work. Pushing the session
    // below the fold to report on it would invert what the page is for.
    renderPage()

    const week = await screen.findByText("接下来七天")
    const session = await screen.findByRole("heading", { name: "这个科目还没有任何内容" })
    expect(week.compareDocumentPosition(session)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it("still shows the queue when the forecast could not be read", async () => {
    // Losing an optional panel must not cost you the page it sits on.
    mocks.getReviewForecast.mockRejectedValue(new Error("读取失败"))
    renderPage()

    expect(await screen.findByText("待复习")).toBeInTheDocument()
    expect(screen.queryByText("接下来七天")).not.toBeInTheDocument()
  })
})
