import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Lesson } from "@/api/lessons"
import { ApiError } from "@/api/client"
import Lessons from "./Lessons"

const mocks = vi.hoisted(() => ({ listLessons: vi.fn(), createLesson: vi.fn() }))

vi.mock("@/api/lessons", async () => {
  const actual = await vi.importActual<typeof import("@/api/lessons")>("@/api/lessons")
  return { ...actual, listLessons: mocks.listLessons, createLesson: mocks.createLesson }
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

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/lessons"]}>
      <Routes>
        <Route path="/lessons" element={<Lessons />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
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

  it("says how much practice a lesson holds before it is opened", async () => {
    // The section count says nothing about practice, and that is part of deciding
    // whether to open one.
    mocks.listLessons.mockResolvedValue({ items: [{ ...lesson, practice_questions: 3 }], count: 1 })
    renderPage()

    expect(await screen.findByText("3 道练习题")).toBeInTheDocument()
  })

  it("stays quiet when a lesson holds no practice", async () => {
    mocks.listLessons.mockResolvedValue({ items: [{ ...lesson, practice_questions: 0 }], count: 1 })
    renderPage()

    expect(await screen.findByRole("link", { name: /Newton's second law/ })).toBeInTheDocument()
    expect(screen.queryByText(/道练习题/)).not.toBeInTheDocument()
  })

  it("says how much of a lesson is actually written", async () => {
    // "10 个环节" reads the same on a skeleton and on a finished lesson.
    mocks.listLessons.mockResolvedValue({
      items: [{ ...lesson, sections_count: 10, filled_sections: 4 }],
      count: 1,
    })
    renderPage()

    const filled = await screen.findByText(/已填 4\/10/)
    expect(filled).toBeInTheDocument()
    expect(filled.closest("[data-lesson-filled='true']")).not.toBeNull()
  })

  it("does not claim filled sections for an older backend that omits the count", async () => {
    mocks.listLessons.mockResolvedValue({ items: [{ ...lesson, sections_count: 10 }], count: 1 })
    renderPage()

    expect(await screen.findByText("10 个环节")).toBeInTheDocument()
    expect(screen.queryByText(/已填/)).not.toBeInTheDocument()
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

    // Nothing answered, so suspecting the backend is the likely cause.
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取课程，请确认本地后端正在运行。")
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })

  it("does not ask whether the backend is running when it just answered", async () => {
    // An ApiError means the server replied: the advice would be false, and it is
    // the one party that knows what happened.
    mocks.listLessons.mockRejectedValueOnce(new ApiError(500, "list lessons failed"))
    renderPage()

    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取课程：服务出错（500）")
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

  it("loads the next page instead of stopping at the first hundred", async () => {
    // The page says how many there are, so one request of 100 is not the library.
    const page = (offset: number) =>
      offset === 0
        ? { count: 3, items: [lesson, { ...lesson, id: "lesson-2", title: "第二门" }] }
        : { count: 3, items: [{ ...lesson, id: "lesson-3", title: "第三门" }] }
    mocks.listLessons.mockImplementation((options?: { offset?: number }) => Promise.resolve(page(options?.offset ?? 0)))
    renderPage()
    await screen.findByRole("link", { name: /Newton's second law/ })

    fireEvent.click(screen.getByRole("button", { name: "加载更多（还有 1 门）" }))

    await waitFor(() => expect(mocks.listLessons).toHaveBeenCalledWith(expect.objectContaining({ offset: 2 })))
    expect(await screen.findByRole("link", { name: /第三门/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /加载更多/ })).not.toBeInTheDocument()
  })

  it("offers nothing to load when the first page is the whole library", async () => {
    mocks.listLessons.mockResolvedValue({ items: [lesson], count: 1 })
    renderPage()
    await screen.findByRole("link", { name: /Newton's second law/ })

    expect(screen.queryByRole("button", { name: /加载更多/ })).not.toBeInTheDocument()
  })

  it("creates a blank course and opens it ready to write in", async () => {
    // Until now a course could only arrive from 整合; the editor can fill all ten
    // sections, so a hand-written one is worth starting.
    mocks.listLessons.mockResolvedValue({ items: [], count: 0 })
    mocks.createLesson.mockResolvedValue({ ...lesson, id: "lesson-new", title: "受力分析" })
    renderPage()

    fireEvent.click(screen.getByRole("button", { name: "新建课程" }))
    fireEvent.change(screen.getByLabelText("新课程标题"), { target: { value: "受力分析" } })
    fireEvent.click(screen.getByRole("button", { name: "创建" }))

    await waitFor(() => expect(mocks.createLesson).toHaveBeenCalledWith({ title: "受力分析" }))
    // Straight into editing: a blank skeleton on a reading page has nothing to do.
    expect(await screen.findByTestId("location")).toHaveTextContent("/lessons/lesson-new?edit=1")
  })

  it("asks for a title before creating anything", async () => {
    mocks.listLessons.mockResolvedValue({ items: [], count: 0 })
    renderPage()

    fireEvent.click(screen.getByRole("button", { name: "新建课程" }))
    fireEvent.click(screen.getByRole("button", { name: "创建" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("给这门课起个标题")
    expect(mocks.createLesson).not.toHaveBeenCalled()
  })

  it("narrows the list to one status", async () => {
    mocks.listLessons.mockResolvedValue({ items: [lesson], count: 1 })
    renderPage()
    await screen.findByRole("link", { name: /Newton's second law/ })

    fireEvent.click(screen.getByRole("combobox", { name: "按状态筛选课程" }))
    const draftOption = await screen.findByRole("option", { name: "草稿" })
    fireEvent.pointerDown(draftOption)
    fireEvent.click(draftOption)

    await waitFor(() => expect(mocks.listLessons).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "draft", offset: 0 }),
    ))
  })

  it("says the filter emptied the page, not the library", async () => {
    // The same lie the search-only empty state used to tell.
    mocks.listLessons.mockImplementation((options?: { status?: string }) =>
      Promise.resolve(options?.status ? { items: [], count: 0 } : { items: [lesson], count: 1 }),
    )
    renderPage()
    await screen.findByRole("link", { name: /Newton's second law/ })

    fireEvent.click(screen.getByRole("combobox", { name: "按状态筛选课程" }))
    const archived = await screen.findByRole("option", { name: "已归档" })
    fireEvent.pointerDown(archived)
    fireEvent.click(archived)

    expect(await screen.findByText(/没有状态为「已归档」的课程/)).toBeInTheDocument()
    expect(screen.queryByText("还没有课程")).not.toBeInTheDocument()
  })
})
