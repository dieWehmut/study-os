import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReviewForecast } from "./ReviewForecast"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  getReviewForecast: vi.fn(),
}))

vi.mock("@/api/reviews", () => mocks)

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

describe("ReviewForecast", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    mocks.getReviewForecast.mockResolvedValue(forecast([4, 9, 2, 0, 6, 1, 3]))
  })

  it("shows a bar for every day of the horizon, empty ones included", async () => {
    // A day with nothing due is the most useful day on the chart: it is where
    // you can afford to add cards. Dropping it would leave the reader doing
    // date arithmetic to notice the gap.
    render(<ReviewForecast />)

    const bars = await screen.findAllByRole("listitem")
    expect(bars).toHaveLength(7)
  })

  it("says how many the worst day is holding", async () => {
    // The number that decides whether you do today's cards is the size of the
    // spike waiting for you, not today's count.
    render(<ReviewForecast />)

    expect(await screen.findByText(/最多的一天 9 张/)).toBeInTheDocument()
  })

  it("calls today by its name rather than a date you have to decode", async () => {
    render(<ReviewForecast />)

    expect(await screen.findByText("今天")).toBeInTheDocument()
    expect(screen.getByText("明天")).toBeInTheDocument()
  })

  it("scales every bar against the busiest day, so the spike is visible", async () => {
    // Scaling each bar against a fixed ceiling would flatten the whole chart on
    // a light week and clip it on a heavy one. The point of the panel is the
    // shape, not the absolute height.
    render(<ReviewForecast />)
    await screen.findByText("今天")

    const busiest = screen.getByTitle("2026-08-10：9 张")
    const quiet = screen.getByTitle("2026-08-11：2 张")
    expect(busiest).toHaveStyle({ height: "100%" })
    expect(quiet.getAttribute("style")).toContain("22%")
  })

  it("says the week is clear rather than drawing seven empty bars", async () => {
    // Seven flat bars read as a broken chart. Nothing due is good news and
    // should say so.
    mocks.getReviewForecast.mockResolvedValue(forecast([0, 0, 0, 0, 0, 0, 0]))
    render(<ReviewForecast />)

    expect(await screen.findByText(/这一周没有排期/)).toBeInTheDocument()
    expect(screen.queryAllByRole("listitem")).toHaveLength(0)
  })

  it("asks only for the subject in hand", async () => {
    useSubjectStore.setState({ subject: "physics" })
    render(<ReviewForecast />)

    await waitFor(() => expect(mocks.getReviewForecast).toHaveBeenCalledWith(7, "physics"))
  })

  it("asks for every subject while none is chosen", async () => {
    render(<ReviewForecast />)

    await waitFor(() => expect(mocks.getReviewForecast).toHaveBeenCalledWith(7, undefined))
  })

  it("stays out of the way when the forecast could not be read", async () => {
    // The panel is context, not the task. A failure here must not push the
    // review queue below the fold or show an alarm about something optional.
    mocks.getReviewForecast.mockRejectedValue(new Error("读取失败"))
    const { container } = render(<ReviewForecast />)

    await waitFor(() => expect(mocks.getReviewForecast).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
