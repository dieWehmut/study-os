import { render, screen } from "@testing-library/react"
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
})
