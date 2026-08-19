import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { LessonSection } from "@/api/lessons"
import LessonPractice from "./LessonPractice"

function renderPractice(content: unknown, overrides: Partial<LessonSection> = {}) {
  const section: LessonSection = {
    id: "practice-1",
    type: "practice",
    title: "马上练一题",
    content,
    ...overrides,
  }
  return render(<LessonPractice section={section} />)
}

describe("LessonPractice", () => {
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
})
