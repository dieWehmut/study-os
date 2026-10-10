import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import { normalizeLesson, type Lesson } from "@/api/lessons"
import LessonDetail from "./LessonDetail"

const mocks = vi.hoisted(() => ({
  getLesson: vi.fn(),
  updateLesson: vi.fn(),
  listLessonVersions: vi.fn(),
  submitLessonPracticeAttempt: vi.fn(),
  listLessonPracticeAttempts: vi.fn(),
}))

vi.mock("@/api/lessons", async () => {
  const actual = await vi.importActual<typeof import("@/api/lessons")>("@/api/lessons")
  return {
    ...actual,
    getLesson: mocks.getLesson,
    updateLesson: mocks.updateLesson,
    listLessonVersions: mocks.listLessonVersions,
  }
})

vi.mock("@/api/lesson-practice", () => ({
  submitLessonPracticeAttempt: mocks.submitLessonPracticeAttempt,
  listLessonPracticeAttempts: mocks.listLessonPracticeAttempts,
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
    mocks.listLessonPracticeAttempts.mockResolvedValue({ count: 0, items: [] })
    mocks.listLessonVersions.mockResolvedValue([
      { version: 3, created_at: "2026-08-21T10:00:00Z", sections_filled: 5 },
      { version: 2, created_at: "2026-08-20T10:00:00Z", sections_filled: 2 },
      { version: 1, created_at: "2026-08-19T10:00:00Z", sections_filled: 0 },
    ])
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

  it("keeps an empty draft scannable instead of repeating a placeholder per section", async () => {
    // Every lesson in the app right now is a draft skeleton, so this is the
    // common page, not an edge case: ten identical panels of "还没有内容" hid
    // the one thing worth seeing -- the shape of the lesson.
    const skeleton: Lesson = {
      id: "lesson-empty",
      title: "还没写的课",
      subject: "physics",
      status: "draft",
      sections: [
        { id: "diagnostic", kind: "diagnostic", title: "诊断", required: true },
        { id: "objectives", kind: "objectives", title: "目标", required: true },
        { id: "concept", kind: "concept", title: "核心概念", required: true },
      ],
      created_at: "2026-08-19T00:00:00Z",
      updated_at: "2026-08-19T00:00:00Z",
    }
    mocks.getLesson.mockResolvedValue(skeleton)
    renderPage()

    expect(await screen.findByText(/这门课程还是一份空草稿/)).toBeInTheDocument()
    // The outline survives: every section is still named...
    expect(screen.getByRole("heading", { name: "核心概念" })).toBeInTheDocument()
    // ...and the sentence is said once, not once per section.
    expect(screen.queryByText("这一节还没有内容。")).not.toBeInTheDocument()
    expect(document.querySelectorAll("[data-section-empty='true']")).toHaveLength(3)
  })

  it("renders a retryable error state", async () => {
    mocks.getLesson.mockRejectedValueOnce(new Error("offline"))
    renderPage()

    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取课程，请确认本地后端正在运行。")
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

  it("passes the lesson route identity into saved practice history", async () => {
    mocks.listLessonPracticeAttempts.mockResolvedValue({
      count: 1,
      items: [{
        id: "history-1",
        lesson_id: "lesson-1",
        section_id: "practice-1",
        answer: "5 N",
        evaluation: "incorrect",
        reference_answer: "6 N",
        feedback: "请重新计算。",
        elapsed_ms: 300,
        created_at: "2026-08-20T00:00:00Z",
      }],
    })
    mocks.getLesson.mockResolvedValue({
      ...lesson,
      sections: [...lesson.sections, {
        id: "practice-1",
        type: "practice",
        title: "马上练一题",
        content: { question: "若 m=2、a=3，F 是多少？", options: ["5 N", "6 N"], correct_answer: "6 N" },
      }],
    })
    renderPage()

    const practice = await screen.findByText("马上练一题")
    const practiceSection = practice.closest("[data-section-kind='practice']")
    expect(practiceSection).not.toBeNull()
    await waitFor(() => expect(within(practiceSection as HTMLElement).getByText("已作答 1 次")).toBeInTheDocument())
    expect(mocks.listLessonPracticeAttempts).toHaveBeenCalledWith("lesson-1", "practice-1")
  })

  it("edits a section and saves the document at the version it read", async () => {
    // The ten-section template was reachable only through the API: a lesson could
    // be created and then never filled in.
    mocks.getLesson.mockResolvedValue({ ...lesson, version: 3 })
    mocks.updateLesson.mockResolvedValue({ ...lesson, version: 4 })
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "编辑内容" }))
    const concept = screen.getByLabelText("核心概念内容")
    expect(concept).toHaveValue("F = ma")

    fireEvent.change(concept, { target: { value: "F = ma，方向与合力一致。" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(mocks.updateLesson).toHaveBeenCalled())
    const [id, input] = mocks.updateLesson.mock.calls[0]
    expect(id).toBe("lesson-1")
    expect(input.version).toBe(3)
    const saved = input.document.sections.find((section: { id: string }) => section.id === "concept")
    expect(saved.content).toEqual({ text: "F = ma，方向与合力一致。" })
    // Every section travels with the write, not just the edited one: the document
    // is replaced whole and the version is what makes that safe.
    expect(input.document.sections).toHaveLength(lesson.sections.length)
    expect(await screen.findByRole("status")).toHaveTextContent("已保存 · 版本 4")
  })

  it("keeps the edits on screen when the version moved on", async () => {
    mocks.getLesson.mockResolvedValue({ ...lesson, version: 3 })
    mocks.updateLesson.mockRejectedValue(new ApiError(409, "lesson version conflict"))
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "编辑内容" }))
    fireEvent.change(screen.getByLabelText("核心概念内容"), { target: { value: "改到一半的内容" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    expect(await screen.findByRole("status")).toHaveTextContent("版本冲突")
    // Still editing, text intact: reloading over the reader's own words is the one
    // thing here that cannot be undone.
    expect(screen.getByLabelText("核心概念内容")).toHaveValue("改到一半的内容")
  })

  it("renames the course and files it, alongside its sections", async () => {
    // A course made from a note arrives called 整合笔记 and filed as 草稿; the name
    // and the filing are as editable as the ten sections.
    mocks.getLesson.mockResolvedValue({ ...lesson, version: 3, subject: "all", status: "draft" })
    mocks.updateLesson.mockResolvedValue({
      ...lesson, version: 4, title: "牛顿第二定律", status: "published", subject: "physics",
    })
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "编辑内容" }))
    const title = screen.getByLabelText("课程标题")
    expect(title).toHaveValue("Newton's second law")
    fireEvent.change(title, { target: { value: "牛顿第二定律" } })

    fireEvent.click(screen.getByRole("combobox", { name: "课程状态" }))
    const published = await screen.findByRole("option", { name: "已发布" })
    fireEvent.pointerDown(published)
    fireEvent.click(published)
    fireEvent.click(screen.getByRole("combobox", { name: "所属学科" }))
    const physics = await screen.findByRole("option", { name: "物理" })
    fireEvent.pointerDown(physics)
    fireEvent.click(physics)

    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(mocks.updateLesson).toHaveBeenCalled())
    const [, input] = mocks.updateLesson.mock.calls[0]
    expect(input.version).toBe(3)
    expect(input.title).toBe("牛顿第二定律")
    expect(input.status).toBe("published")
    expect(input.subject).toBe("physics")
    // Back to reading: the page shows what was saved rather than the old name.
    expect(await screen.findByRole("heading", { name: "牛顿第二定律" })).toBeInTheDocument()
    expect(screen.getByText("已发布")).toBeInTheDocument()
  })

  it("reads an older revision, and says it is read-only", async () => {
    // Documents are immutable, so the history is the only way back to what a
    // lesson said before it was edited.
    mocks.getLesson.mockImplementation((_id: string, version?: number) => Promise.resolve(
      version === undefined
        ? { ...lesson, version: 3 }
        : { ...lesson, version, sections: [{ id: "concept", kind: "concept", title: "核心概念", body: "旧版的一句话" }] },
    ))
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "版本历史" }))
    expect(await screen.findByText(/第 3 版/)).toBeInTheDocument()
    expect(screen.getByText("当前")).toBeInTheDocument()
    expect(screen.getByText(/第 1 版/)).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole("button", { name: "查看" })[2])

    await waitFor(() => expect(mocks.getLesson).toHaveBeenCalledWith("lesson-1", 1))
    expect(await screen.findByText("正在查看第 1 版（只读）")).toBeInTheDocument()
    expect(screen.getByText("旧版的一句话")).toBeInTheDocument()
    // Editing from here would write against a version that is no longer current.
    expect(screen.queryByRole("button", { name: "编辑内容" })).not.toBeInTheDocument()
  })

  it("restores a revision by writing it again, not by overwriting it", async () => {
    const oldDocument = { id: "concept", kind: "concept", title: "核心概念", body: "旧版的一句话" }
    mocks.getLesson.mockImplementation((_id: string, version?: number) => Promise.resolve(
      version === undefined
        ? { ...lesson, version: 3 }
        : { ...lesson, version, sections: [oldDocument] },
    ))
    mocks.updateLesson.mockResolvedValue({ ...lesson, version: 4, sections: [oldDocument] })
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "版本历史" }))
    await screen.findByText(/第 3 版/)
    fireEvent.click(screen.getAllByRole("button", { name: "恢复这一版" })[1])

    await waitFor(() => expect(mocks.updateLesson).toHaveBeenCalled())
    const [, input] = mocks.updateLesson.mock.calls[0]
    // Written against the version that is current (3), with the old document: the
    // result is version 4 and version 1 stays in the history.
    expect(input.version).toBe(3)
    expect(input.document.sections[0].body).toBe("旧版的一句话")
    expect(await screen.findByRole("status")).toHaveTextContent("已恢复第 1 版 · 现在是版本 4")
  })

  it("says what a revision changed about the one before it", async () => {
    // The history says how much each revision holds; deciding which one to go
    // back to is a question about what changed.
    mocks.getLesson.mockImplementation((_id: string, version?: number) => Promise.resolve(
      version === undefined
        ? { ...lesson, version: 3 }
        : version === 3
          ? { ...lesson, version: 3, sections: [
              { id: "concept", kind: "concept", title: "核心概念", body: "F = ma\n方向与合力一致" },
              { id: "summary", kind: "summary", title: "总结", body: "一句话" },
            ] }
          : { ...lesson, version: 2, sections: [
              { id: "concept", kind: "concept", title: "核心概念", body: "F = ma" },
            ] },
    ))
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "版本历史" }))
    await screen.findByText(/第 3 版/)
    // The newest row first: versions 2 and 3 both offer a comparison.
    fireEvent.click(screen.getAllByRole("button", { name: "对比上一版" })[0])

    const changes = await screen.findByRole("list", { name: "第 3 版的变化" })
    expect(within(changes).getByText("核心概念")).toBeInTheDocument()
    expect(within(changes).getByText("2 行（+1）")).toBeInTheDocument()
    expect(within(changes).getByText("总结")).toBeInTheDocument()
    expect(within(changes).getByText("新增（1 行）")).toBeInTheDocument()
    // Only the sections that moved are listed.
    expect(within(changes).queryByText("诊断")).not.toBeInTheDocument()

    // The oldest revision has nothing to compare with, and a second click closes.
    expect(screen.getAllByRole("button", { name: "对比上一版" })).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "收起对比" }))
    expect(screen.queryByRole("list", { name: "第 3 版的变化" })).not.toBeInTheDocument()
  })

  it("fills in a practice question, choosing the key from the options", async () => {
    // A course made from a note arrives with an empty practice section, so without
    // this the section said 这道练习暂时没有可交互的选项 forever.
    mocks.getLesson.mockResolvedValue({
      ...lesson,
      version: 3,
      sections: [...lesson.sections, { id: "practice", type: "practice", title: "即时练习", content: {} }],
    })
    mocks.updateLesson.mockResolvedValue({ ...lesson, version: 4 })
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "编辑内容" }))
    fireEvent.change(screen.getByLabelText("练习题干"), {
      target: { value: "若 m = 4 kg、a = 2 m/s²，F 是多少？" },
    })
    fireEvent.change(screen.getByLabelText("练习选项"), { target: { value: "2 N\n6 N\n8 N" } })
    fireEvent.change(screen.getByLabelText("练习解析"), { target: { value: "F = ma。" } })
    // Until a key is chosen, the editor says what saving without one means.
    expect(screen.getByText(/按「未评分」处理/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("combobox", { name: "练习标准答案" }))
    const answer = await screen.findByRole("option", { name: "8 N" })
    fireEvent.pointerDown(answer)
    fireEvent.click(answer)

    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(mocks.updateLesson).toHaveBeenCalled())
    const [, input] = mocks.updateLesson.mock.calls[0]
    const practice = input.document.sections.find((section: { type: string }) => section.type === "practice")
    expect(practice.content).toEqual({
      question: "若 m = 4 kg、a = 2 m/s²，F 是多少？",
      options: ["2 N", "6 N", "8 N"],
      correct_answer: "8 N",
      explanation: "F = ma。",
    })
  })

  it("leaves a quiz-typed section alone rather than rewriting content it cannot read", async () => {
    // The fixture's 先试一题 is a legacy shape; the practice editor must not touch it.
    mocks.getLesson.mockResolvedValue({ ...lesson, version: 3 })
    mocks.updateLesson.mockResolvedValue({ ...lesson, version: 4 })
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "编辑内容" }))
    expect(screen.queryByLabelText("练习题干")).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("核心概念内容"), { target: { value: "F = ma" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(mocks.updateLesson).toHaveBeenCalled())
    const [, input] = mocks.updateLesson.mock.calls[0]
    const quiz = input.document.sections.find((section: { id: string }) => section.id === "quiz")
    expect(quiz.body).toBe("若 m=2、a=3，F 是多少？")
    expect(quiz.items).toEqual(["6 N", "5 N"])
  })

  it("warns before a reload throws unsaved edits away", async () => {
    mocks.getLesson.mockResolvedValue({ ...lesson, version: 3 })
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "编辑内容" }))
    // Nothing typed yet: leaving is free, so nothing should stop the reader.
    const clean = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    fireEvent.change(screen.getByLabelText("核心概念内容"), { target: { value: "改了一半" } })
    expect(screen.getByText("有未保存的改动")).toBeInTheDocument()
    const dirty = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)

    // 取消 is how a reader abandons edits on purpose; after that the warning goes.
    fireEvent.click(screen.getByRole("button", { name: "放弃改动" }))
    const afterwards = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(afterwards)
    expect(afterwards.defaultPrevented).toBe(false)
  })

  it("opens ready to write in when a new course arrives with ?edit=1", async () => {
    mocks.getLesson.mockResolvedValue({ ...lesson, version: 1 })
    render(
      <MemoryRouter initialEntries={["/lessons/lesson-1?edit=1"]}>
        <Routes>
          <Route path="/lessons/:id" element={<LessonDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    // Straight into the editor, with the sections already seeded from the lesson.
    expect(await screen.findByLabelText("课程标题")).toHaveValue("Newton's second law")
    expect(screen.getByLabelText("核心概念内容")).toHaveValue("F = ma")
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument()
  })
})
