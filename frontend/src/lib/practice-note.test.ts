import { describe, expect, it } from "vitest"

import { practiceNote } from "./practice-note"

describe("practiceNote", () => {
  it("asks the question first, then the answer, the wrong pick, and why", () => {
    expect(
      practiceNote({
        question: "水的沸点在标准大气压下是多少？",
        answerLabel: "100 °C",
        picked: "90 °C",
        explanation: "标准大气压下，水在 100 °C 沸腾。",
      }),
    ).toBe(
      "水的沸点在标准大气压下是多少？\n\n正确答案：100 °C\n当时选的：90 °C\n解析：标准大气压下，水在 100 °C 沸腾。",
    )
  })

  it("keeps a blank line after the question so the name stops there", () => {
    // The library names an item by its first line, so the break is load-bearing.
    const note = practiceNote({ question: "F = ma 里 a 指什么？", answerLabel: "加速度" })
    expect(note.split("\n")[0]).toBe("F = ma 里 a 指什么？")
    expect(note.split("\n")[1]).toBe("")
  })

  it("says the answer is unregistered instead of leaving a gap", () => {
    expect(practiceNote({ question: "举一个例子。", picked: "自由回答" })).toContain("标准答案：未登记")
  })

  it("leaves out the lines there is nothing to say on", () => {
    const note = practiceNote({ question: "2 + 2 = ?", answerLabel: "4" })
    expect(note).not.toContain("当时选的")
    expect(note).not.toContain("解析")
  })
})