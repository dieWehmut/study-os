import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import type { LessonSection } from "@/api/lessons"
import LessonPractice from "./LessonPractice"

const mocks = vi.hoisted(() => ({
  submitLessonPracticeAttempt: vi.fn(),
  listLessonPracticeAttempts: vi.fn(),
  dumpThought: vi.fn(),
  scheduleKnowledge: vi.fn(),
}))

vi.mock("@/api/lesson-practice", () => ({
  submitLessonPracticeAttempt: mocks.submitLessonPracticeAttempt,
  listLessonPracticeAttempts: mocks.listLessonPracticeAttempts,
}))
vi.mock("@/api/chat", () => ({ dumpThought: mocks.dumpThought }))
vi.mock("@/api/knowledge", () => ({ scheduleKnowledge: mocks.scheduleKnowledge }))

function renderPractice(content: unknown, overrides: Partial<LessonSection> = {}, lessonID?: string) {
  const section: LessonSection = {
    id: "practice-1",
    type: "practice",
    title: "马上练一题",
    content,
    ...overrides,
  }
  return render(
    <MemoryRouter>
      <LessonPractice lessonID={lessonID} section={section} />
    </MemoryRouter>,
  )
}

describe("LessonPractice", () => {
  beforeEach(() => {
    mocks.submitLessonPracticeAttempt.mockReset()
    mocks.listLessonPracticeAttempts.mockReset()
    mocks.dumpThought.mockReset()
    mocks.scheduleKnowledge.mockReset()
    mocks.listLessonPracticeAttempts.mockResolvedValue({ count: 0, items: [] })
    mocks.dumpThought.mockResolvedValue({ id: "dump-1", term: "水的沸点是多少？" })
    mocks.scheduleKnowledge.mockResolvedValue({ status: "scheduled", knowledge_id: "dump-1", prompt_count: 3 })
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

  // A section that asks several questions renders all of them, each with its own
// answer, and the section keeps the tally. It used to render the first and say the
// rest were missing -- less than useful, but at least not silent.
it("asks every question of a section and counts the round", () => {
  renderPractice({
    questions: [
      { id: "q1", question: "速度的单位是什么？", options: ["m/s", "N"], correct_answer: "m/s" },
      { id: "q2", question: "力的单位是什么？", options: ["N", "J"], correct_answer: "N" },
      { id: "q3", question: "功的单位是什么？", options: ["J", "N"], correct_answer: "J" },
    ],
  })

  expect(screen.getByText("速度的单位是什么？")).toBeInTheDocument()
  expect(screen.getByText("力的单位是什么？")).toBeInTheDocument()
  expect(screen.getByText("功的单位是什么？")).toBeInTheDocument()
  expect(screen.getAllByRole("button", { name: "提交答案" })).toHaveLength(3)
  expect(screen.getByRole("article")).toHaveAttribute("data-practice-question-count", "3")

  // Answering one question must not answer another: each form has its own answer.
  fireEvent.click(screen.getAllByRole("radio", { name: "m/s" })[0]!)
  fireEvent.click(screen.getAllByRole("button", { name: "提交答案" })[0]!)
  expect(screen.getAllByRole("button", { name: "提交答案" })[1]).toBeDisabled()

  expect(screen.getByText(/本节已作答 1\/3 道/)).toHaveTextContent("答对 1 道")
})

it("names the question it submits, and leaves the field out when there is only one", async () => {
  mocks.submitLessonPracticeAttempt.mockResolvedValue({
    id: "lesson-attempt-q1",
    lesson_id: "lesson-1",
    section_id: "practice-1",
    answer: "m/s",
    evaluation: "correct",
    reference_answer: "m/s",
    feedback: "服务端确认正确。",
    elapsed_ms: 8,
    created_at: "2026-08-21T00:00:00Z",
  })
  const { unmount } = renderPractice(
    { questions: [{ id: "q1", question: "速度的单位是什么？", options: ["m/s", "N"], correct_answer: "m/s" }] },
    {},
    "lesson-1",
  )

  fireEvent.click(screen.getByRole("radio", { name: "m/s" }))
  fireEvent.click(screen.getByRole("button", { name: "提交答案" }))
  await waitFor(() => expect(mocks.submitLessonPracticeAttempt).toHaveBeenCalledWith(
    "lesson-1",
    "practice-1",
    expect.objectContaining({ answer: "m/s", questionId: "q1" }),
  ))
  unmount()

  // The single-question shape sends no questionId at all, so its request body is
  // what it always was.
  mocks.submitLessonPracticeAttempt.mockClear()
  renderPractice({ question: "2 + 2 = ?", options: ["3", "4"], answer: "4" }, {}, "lesson-1")
  fireEvent.click(screen.getByRole("radio", { name: "4" }))
  fireEvent.click(screen.getByRole("button", { name: "提交答案" }))
  await waitFor(() => expect(mocks.submitLessonPracticeAttempt).toHaveBeenCalledWith(
    "lesson-1",
    "practice-1",
    expect.objectContaining({ answer: "4", questionId: "" }),
  ))
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

  it("files a wrong answer as a card, question first", async () => {
    // A wrong answer that leaves only an attempt behind is a mistake the reader
    // will make again; the card puts the same question back in front of them.
    mocks.submitLessonPracticeAttempt.mockResolvedValue({
      id: "lesson-attempt-2",
      lesson_id: "lesson-1",
      section_id: "practice-1",
      answer: "90 °C",
      evaluation: "incorrect",
      reference_answer: "100 °C",
      feedback: "再查一下标准大气压下的沸点。",
      elapsed_ms: 20,
      created_at: "2026-08-20T00:00:01Z",
    })
    renderPractice(
      {
        question: "水的沸点在标准大气压下是多少？",
        options: ["90 °C", "100 °C"],
        correct_answer: "100 °C",
        explanation: "标准大气压下，水在 100 °C 沸腾。",
      },
      {},
      "lesson-1",
    )

    fireEvent.click(screen.getByRole("radio", { name: "90 °C" }))
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))
    fireEvent.click(await screen.findByRole("button", { name: "收进知识库" }))

    await waitFor(() => expect(mocks.dumpThought).toHaveBeenCalledTimes(1))
    const note = mocks.dumpThought.mock.calls[0][0] as string
    expect(note.split("\n")[0]).toBe("水的沸点在标准大气压下是多少？")
    expect(note).toContain("正确答案：100 °C")
    expect(note).toContain("当时选的：90 °C")
    expect(note).toContain("解析：标准大气压下，水在 100 °C 沸腾。")
    await waitFor(() => expect(mocks.scheduleKnowledge).toHaveBeenCalledWith("dump-1"))
    expect(screen.getByRole("button", { name: "已收进知识库" })).toBeDisabled()
    expect(screen.getByRole("link", { name: "去记忆" })).toHaveAttribute("href", "/memory")
  })

  it("offers nothing to file when the answer was right", () => {
    renderPractice({ question: "2 + 2 = ?", options: ["3", "4"], correct_answer: "4" }, {}, "lesson-1")

    fireEvent.click(screen.getByRole("radio", { name: "4" }))
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))

    expect(screen.getByRole("status")).toHaveTextContent("回答正确")
    expect(screen.queryByRole("button", { name: "收进知识库" })).not.toBeInTheDocument()
  })

  it("says so when the wrong answer cannot be filed, and stays clickable", async () => {
    mocks.dumpThought.mockRejectedValueOnce(new ApiError(500, "保存念头失败"))
    renderPractice({ question: "2 + 2 = ?", options: ["3", "4"], correct_answer: "4" }, {}, "lesson-1")

    fireEvent.click(screen.getByRole("radio", { name: "3" }))
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }))
    fireEvent.click(await screen.findByRole("button", { name: "收进知识库" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("收进知识库失败：保存念头失败")
    expect(screen.getByRole("button", { name: "收进知识库" })).toBeEnabled()
    expect(mocks.scheduleKnowledge).not.toHaveBeenCalled()
  })
})
