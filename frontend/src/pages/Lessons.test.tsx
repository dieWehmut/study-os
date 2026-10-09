import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Lesson } from "@/api/lessons"
import Lessons from "./Lessons"

const mocks = vi.hoisted(() => ({ listLessons: vi.fn() }))

vi.mock("@/api/lessons", async () => {
  const actual = await vi.importActual<typeof import("@/api/lessons")>("@/api/lessons")
  return { ...actual, listLessons: mocks.listLessons }
})

vi.mock("@/features/subjects/SubjectChips", () => ({
  SubjectChips: () => <div data-testid="subject-chips" />,
}))

const lesson: Lesson = {
  id: "lesson-1",
  title: "Newton's second law",
  subject: "physics",
  status: "reviewed",
  source: { id: "source-1", title: "Mechanics notes", type: "markdown" },
  sections: [
    { id: "concept", kind: "concept", title: "Core concept", body: "F = ma" },
  ],
  estimated_minutes: 20,
  created_at: "2026-08-19T00:00:00Z",
  updated_at: "2026-08-19T00:00:00Z",
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Lessons />
    </MemoryRouter>,
  )
}

describe("lessons page", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows a scannable lesson card with source and status", async () => {
    mocks.listLessons.mockResolvedValue({ items: [lesson], count: 1 })
    renderPage()

    expect(await screen.findByRole("link", { name: /Newton's second law/ })).toHaveAttribute(
      "href",
      "/lessons/lesson-1",
    )
    expect(screen.getByText(/来源：Mechanics notes/)).toBeInTheDocument()
    expect(screen.getByText("已审核")).toBeInTheDocument()
  })

  it("shows an actionable empty state", async () => {
    mocks.listLessons.mockResolvedValue({ items: [], count: 0 })
    renderPage()

    expect(await screen.findByText("还没有课程")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "去整合资料" })).toHaveAttribute("href", "/integrate")
  })

  it("shows a retry action when loading fails", async () => {
    mocks.listLessons.mockRejectedValueOnce(new Error("offline"))
    renderPage()

    expect(await screen.findByRole("alert")).toHaveTextContent("课程暂时无法读取")
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })

  it("finds an older course the first page never carried", async () => {
    // The page holds 100 courses; past that the rest are not hard to find --
    // they are not in the list at all.
    mocks.listLessons.mockImplementation((options?: { query?: string }) =>
      Promise.resolve(
        options?.query ? { items: [{ ...lesson, id: "lesson-old", title: "受力图入门" }], count: 1 } : { items: [], count: 0 },
      ),
    )
    renderPage()
    await waitFor(() => expect(mocks.listLessons).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText("搜索课程标题"), { target: { value: "受力图" } })
    fireEvent.click(screen.getByRole("button", { name: "搜索课程" }))

    await waitFor(() => expect(mocks.listLessons).toHaveBeenCalledWith(expect.objectContaining({ query: "受力图" })))
    expect(await screen.findByRole("link", { name: /受力图入门/ })).toBeInTheDocument()
    expect(screen.getByText(/只显示标题含「受力图」的课程/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "清除" }))

    // Back to the unfiltered page, which is empty here -- and says so as a
    // library with no courses rather than a search that matched nothing.
    expect(await screen.findByText("还没有课程")).toBeInTheDocument()
  })

  it("does not tell you the library is empty when only the search is", async () => {
    mocks.listLessons.mockImplementation((options?: { query?: string }) =>
      Promise.resolve(options?.query ? { items: [], count: 0 } : { items: [lesson], count: 1 }),
    )
    renderPage()
    await screen.findByRole("link", { name: /Newton's second law/ })

    fireEvent.change(screen.getByLabelText("搜索课程标题"), { target: { value: "不存在" } })
    fireEvent.click(screen.getByRole("button", { name: "搜索课程" }))

    expect(await screen.findByText(/没有标题含「不存在」的课程/)).toBeInTheDocument()
    expect(screen.queryByText("还没有课程")).not.toBeInTheDocument()
  })
})
