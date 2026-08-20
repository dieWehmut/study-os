import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { normalizeLesson, type Lesson } from "@/api/lessons"
import LessonDetail from "./LessonDetail"

const mocks = vi.hoisted(() => ({ getLesson: vi.fn(), submitLessonPracticeAttempt: vi.fn() }))

vi.mock("@/api/lessons", async () => {
  const actual = await vi.importActual<typeof import("@/api/lessons")>("@/api/lessons")
  return { ...actual, getLesson: mocks.getLesson }
})

vi.mock("@/api/lesson-practice", () => ({
  submitLessonPracticeAttempt: mocks.submitLessonPracticeAttempt,
}))

const lesson: Lesson = {
  id: "lesson-1",
  title: "Newton's second law",
  subject: "physics",
  status: "published",
  source: { id: "source-1", title: "Mechanics notes", type: "markdown", locator: "p. 3" },
  objectives: ["识别变量", "建立受力关系"],
  sections: [
    { id: "quiz", kind: "quiz", title: "先试一题", body: "若 m=2、a=3，F 是多少？", items: ["6 N", "5 N"] },
    { id: "concept", kind: "concept", title: "核心概念", body: "F = ma" },
    { id: "diagnostic", kind: "diagnostic", title: "开始前", body: "你见过哪些力？" },
  ],
  estimated_minutes: 20,
  created_at: "2026-08-19T00:00:00Z",
  updated_at: "2026-08-19T00:00:00Z",
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/lessons/lesson-1"]}>
      <Routes>
        <Route path="/lessons/:id" element={<LessonDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("lesson detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.submitLessonPracticeAttempt.mockResolvedValue({
      id: "lesson-attempt-test",
      lesson_id: "lesson-1",
      section_id: "practice-1",
      answer: "6 N",
      evaluation: "correct",
      reference_answer: "6 N",
      feedback: "服务端反馈：F = ma，所以 2 × 3 = 6 N。",
      elapsed_ms: 10,
      created_at: "2026-08-20T00:00:00Z",
    })
  })

  it("orders fixed sections for scanning and exposes provenance", async () => {
    mocks.getLesson.mockResolvedValue(lesson)
    renderPage()

    expect(await screen.findByRole("heading", { name: "Newton's second law" })).toBeInTheDocument()
    expect(screen.getByText("来源：Mechanics notes · p. 3")).toBeInTheDocument()
    expect(screen.getByText("已发布")).toBeInTheDocument()

    const sections = Array.from(document.querySelectorAll("[data-section-kind]"))
    expect(sections.map((section) => section.getAttribute("data-section-kind"))).toEqual([
      "diagnostic",
      "concept",
      "quiz",
    ])
  })

  it("renders a retryable error state", async () => {
    mocks.getLesson.mockRejectedValueOnce(new Error("offline"))
    renderPage()

    expect(await screen.findByRole("alert")).toHaveTextContent("课程暂时无法读取")
    expect(screen.getByRole("link", { name: "返回课程" })).toHaveAttribute("href", "/lessons")
  })

  it("derives objectives from the canonical document section when no top-level field exists", async () => {
    const documentOnlyLesson = normalizeLesson({
      id: "lesson-document-only",
      title: "Document-backed lesson",
      subject: "physics",
      status: "published",
      document: {
        schema_version: 12,
        sections: [
          {
            id: "objectives-1",
            type: "objectives",
            title: "学习目标",
            content: { items: ["说出牛顿第二定律", "用公式解释一个例子"] },
          },
          { id: "concept-1", type: "concept", title: "核心概念", content: "F = ma" },
        ],
      },
    })
    expect(documentOnlyLesson.objectives).toBeUndefined()
    mocks.getLesson.mockResolvedValue(documentOnlyLesson)
    render(
      <MemoryRouter initialEntries={["/lessons/lesson-document-only"]}>
        <Routes>
          <Route path="/lessons/:id" element={<LessonDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole("heading", { name: "Document-backed lesson" })).toBeInTheDocument()
    const objectiveCard = screen.getByText("这次只需要带走").closest("[data-slot='card']")
    expect(objectiveCard).not.toBeNull()
    expect(within(objectiveCard as HTMLElement).getByText("说出牛顿第二定律")).toBeInTheDocument()
    expect(within(objectiveCard as HTMLElement).getByText("用公式解释一个例子")).toBeInTheDocument()
  })

  it("turns a structured practice section into an immediate local check", async () => {
    mocks.getLesson.mockResolvedValue({
      ...lesson,
      sections: [
        ...lesson.sections,
        {
          id: "practice-1",
          type: "practice",
          title: "马上练一题",
          position: 5,
          content: {
            question: "若 m=2、a=3，F 是多少？",
            options: ["5 N", "6 N"],
            correct_answer: "6 N",
            explanation: "F = ma，所以 2 × 3 = 6 N。",
          },
        },
      ],
    })
    renderPage()

    const practice = await screen.findByText("马上练一题")
    const practiceSection = practice.closest("[data-section-kind='practice']")
    expect(practiceSection).not.toBeNull()
    const practiceView = within(practiceSection as HTMLElement)
    expect(practiceView.getByText("若 m=2、a=3，F 是多少？")).toBeInTheDocument()
    fireEvent.click(practiceView.getByRole("radio", { name: "6 N" }))
    fireEvent.click(practiceView.getByRole("button", { name: "提交答案" }))

    expect(practiceView.getByRole("status")).toHaveTextContent("回答正确")
    expect(practiceView.getByRole("status")).toHaveTextContent("F = ma，所以 2 × 3 = 6 N。")
    await waitFor(() => expect(practiceView.getByText("已保存答题证据")).toBeInTheDocument())
    expect(mocks.submitLessonPracticeAttempt).toHaveBeenCalledWith(
      "lesson-1",
      "practice-1",
      expect.objectContaining({ answer: "6 N", elapsedMs: expect.any(Number) }),
    )
  })
})
