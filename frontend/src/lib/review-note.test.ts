import { describe, expect, it } from "vitest"

import { answerNote, cardNote, practiceNote } from "./review-note"

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

  it("says the answer is unregistered instead of leaving a gap", () => {
    expect(practiceNote({ question: "举一个例子。", picked: "自由回答" })).toContain("标准答案：未登记")
  })

  it("leaves out the lines there is nothing to say on", () => {
    const note = practiceNote({ question: "2 + 2 = ?", answerLabel: "4" })
    expect(note).not.toContain("当时选的")
    expect(note).not.toContain("解析")
  })
})

describe("cardNote and answerNote", () => {
  it("puts the question on the first line and a blank line under it", () => {
    // The library names an item by its first line, so the break is load-bearing.
    for (const note of [cardNote("速度", "速度描述运动的快慢。"), answerNote("导数是什么？", "导数是变化率。")]) {
      const lines = note.split("\n")
      expect(lines[1]).toBe("")
      expect(lines[0].trim()).not.toBe("")
      expect(lines.slice(2).join("\n").trim()).not.toBe("")
    }
  })

  it("trims what it was given rather than carrying stray blank lines", () => {
    expect(cardNote("  速度 ", " 速度描述运动的快慢。 ")).toBe("速度\n\n速度描述运动的快慢。")
  })
})