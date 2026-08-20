import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { LessonSection } from "@/api/lessons"
import LessonPractice from "./LessonPractice"

const mocks = vi.hoisted(() => ({
  submitLessonPracticeAttempt: vi.fn(),
  listLessonPracticeAttempts: vi.fn(),
}))

vi.mock("@/api/lesson-practice", () => ({
  submitLessonPracticeAttempt: mocks.submitLessonPracticeAttempt,
  listLessonPracticeAttempts: mocks.listLessonPracticeAttempts,
}))

function renderPractice(content: unknown, overrides: Partial<LessonSection> = {}, lessonID?: string) {
  const section: LessonSection = {
    id: "practice-1",
    type: "practice",
    title: "马上练一题",
    content,
    ...overrides,
  }
  return render(<LessonPractice lessonID={lessonID} section={section} />)
}

describe("LessonPractice", () => {
  beforeEach(() => {
    mocks.submitLessonPracticeAttempt.mockReset()
    mocks.listLessonPracticeAttempts.mockReset()
  })

  it("lets a learner choose and submit a structured question", () => {
    renderPractice({
      question: "若 m = 4 kg、a = 2 m/s²，F 是多少？",
      options: ["2 N", "6 N", "8 N"],
      answer: "8 N",
      explanation: "先确认单位，再使用 F = ma。",
    })

    expect(screen.getByText("若 m = 4 kg、a = 2 m/s²，F 是多少？")).toBeInTheDocument()
    const submit = screen.getByRole("button", { name: "提交答案" })
    expect(submit).toBeDisabled()

    fireEvent.click(screen.getByRole("radio", { name: "8 N" }))
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    expect(screen.getByRole("status")).toHaveTextContent("回答正确")
    expect(screen.getByRole("status")).toHaveTextContent("先确认单位，再使用 F = ma。")
    expect(screen.getByRole("radio", { name: "8 N" })).toBeDisabled()
  })

  it("accepts correct_answer and reports a wrong choice with the reference", () => {
    renderPractice({
      question: "水的沸点在标准大气压下是多少？",
      options: ["90 °C", "100 °C", "110 °C"],
      correct_answer: "100 °C",
      feedback: "标准大气压下，水在 100 °C 沸腾。",
    })

    fireEvent.click(screen.getByRole("radio", { name: "90 °C" }))
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))

    const result = screen.getByRole("status")
    expect(result).toHaveTextContent("回答不正确")
    expect(result).toHaveTextContent("参考答案：100 °C")
    expect(result).toHaveTextContent("标准大气压下，水在 100 °C 沸腾。")
  })

  it("submits an unanswered-key question without pretending it can grade it", () => {
    renderPractice({
      question: "请说出一个你会使用这个公式的场景。",
      options: ["自由回答", "暂时想不到"],
      feedback: "把公式放回一个具体例子中。",
    })

    fireEvent.click(screen.getByRole("radio", { name: "自由回答" }))
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))

    const result = screen.getByRole("status")
    expect(result).toHaveTextContent("已提交")
    expect(result).toHaveTextContent("暂无标准答案")
    expect(result).toHaveTextContent("把公式放回一个具体例子中。")
    expect(result).not.toHaveTextContent("回答正确")
    expect(result).not.toHaveTextContent("回答不正确")
  })

  it("keeps legacy text sections readable when no structured options exist", () => {
    renderPractice("这道题先用自己的话解释。", { items: ["写出一个例子"] })

    expect(screen.getByText("这道题先用自己的话解释。")).toBeInTheDocument()
    expect(screen.getByText("写出一个例子")).toBeInTheDocument()
    expect(screen.getByText("这道练习暂时没有可交互的选项。")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "提交答案" })).not.toBeInTheDocument()
  })

  it("saves evidence after showing the optimistic result", async () => {
    mocks.submitLessonPracticeAttempt.mockResolvedValue({
      id: "lesson-attempt-1",
      lesson_id: "lesson-1",
      section_id: "practice-1",
      answer: "8 N",
      evaluation: "correct",
      reference_answer: "8 N",
      feedback: "服务端确认正确。",
      elapsed_ms: 12,
      created_at: "2026-08-20T00:00:00Z",
    })
    renderPractice({
      question: "2 + 2 = ?",
      options: ["3", "4"],
      correct_answer: "4",
      explanation: "本地反馈。",
    }, {}, "lesson-1")

    fireEvent.click(screen.getByRole("radio", { name: "4" }))
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))

    expect(screen.getByRole("status")).toHaveTextContent("回答正确")
    await waitFor(() => expect(screen.getByText("已保存答题证据")).toBeInTheDocument())
    expect(screen.getByRole("status")).toHaveTextContent("服务端确认正确。")
    expect(mocks.submitLessonPracticeAttempt).toHaveBeenCalledWith("lesson-1", "practice-1", expect.objectContaining({ answer: "4" }))
  })

  it("keeps local feedback when evidence persistence fails", async () => {
    mocks.submitLessonPracticeAttempt.mockRejectedValue(new Error("offline"))
    render(<LessonPractice
      lessonID="lesson-1"
      section={{
        id: "practice-1",
        type: "practice",
        title: "马上练一题",
        content: { question: "2 + 2 = ?", options: ["3", "4"], correct_answer: "4", explanation: "本地反馈。" },
      }}
    />)

    fireEvent.click(screen.getByRole("radio", { name: "4" }))
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))

    expect(screen.getByRole("status")).toHaveTextContent("本地反馈。")
    await waitFor(() => expect(screen.getByText("答题反馈已显示，但证据保存失败。")).toBeInTheDocument())
  })

  it("shows the latest saved result and count before the next submission", async () => {
    mocks.listLessonPracticeAttempts.mockResolvedValue({
      count: 1,
      items: [{
        id: "lesson-attempt-history",
        lesson_id: "lesson-1",
        section_id: "practice-1",
        answer: "3",
        evaluation: "incorrect",
        reference_answer: "4",
        feedback: "先检查加法结果。",
        elapsed_ms: 640,
        created_at: "2026-08-20T00:00:00Z",
      }],
    })
    renderPractice({ question: "2 + 2 = ?", options: ["3", "4"], correct_answer: "4" }, {}, "lesson-1")

    await waitFor(() => expect(screen.getByText("已作答 1 次")).toBeInTheDocument())
    expect(screen.getByRole("status")).toHaveTextContent("回答不正确")
    expect(screen.getByRole("status")).toHaveTextContent("参考答案：4")
    expect(mocks.listLessonPracticeAttempts).toHaveBeenCalledWith("lesson-1", "practice-1")
  })

  it("keeps the practice usable when history loading fails", async () => {
    mocks.listLessonPracticeAttempts.mockRejectedValue(new Error("offline"))
    renderPractice({ question: "2 + 2 = ?", options: ["3", "4"], correct_answer: "4" }, {}, "lesson-1")

    await waitFor(() => expect(document.querySelector('[data-practice-history="error"]')).toBeInTheDocument())
    const submit = screen.getByRole("button", { name: "提交答案" })
    fireEvent.click(screen.getByRole("radio", { name: "4" }))
    expect(submit).toBeEnabled()
  })
})
