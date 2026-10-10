import { describe, expect, it } from "vitest"

import { normalizeLesson } from "@/api/lessons"
import { lessonToMarkdown } from "./lesson-markdown"

function lessonWith(overrides: Record<string, unknown>) {
  return normalizeLesson({
    id: "lesson-1",
    title: "运动学",
    subject: "physics",
    status: "draft",
    sections: [],
    ...overrides,
  })
}

describe("lessonToMarkdown", () => {
  it("writes the course as a document: title, then one heading per filled section", () => {
    const markdown = lessonToMarkdown(
      lessonWith({
        sections: [
          { id: "objectives", type: "objectives", title: "学习目标", content: { markdown: "会判断匀变速运动。" } },
          { id: "concepts", type: "concepts", title: "核心概念", items: ["速度", "加速度"] },
        ],
      }),
    )

    expect(markdown).toBe(
      [
        "# 运动学",
        "",
        "学科：physics · 状态：draft",
        "",
        "## 学习目标",
        "",
        "会判断匀变速运动。",
        "",
        "## 核心概念",
        "",
        "- 速度",
        "- 加速度",
        "",
      ].join("\n"),
    )
  })

  it("keeps a list a list, so an editor round trip does not merge the bullets", () => {
    const markdown = lessonToMarkdown(
      lessonWith({ sections: [{ id: "concepts", type: "concepts", title: "核心概念", items: ["甲", "乙", "丙"] }] }),
    )

    expect(markdown).toContain("- 甲\n- 乙\n- 丙")
  })

  it("prints the practice question with its answer and explanation", () => {
    const markdown = lessonToMarkdown(
      lessonWith({
        sections: [{
          id: "practice",
          type: "practice",
          title: "马上练一题",
          content: {
            question: "F = ma 里 a 指什么？",
            options: ["速度", "加速度"],
            correct_answer: "加速度",
            explanation: "a 是加速度。",
          },
        }],
      }),
    )

    expect(markdown).toContain("## 马上练一题")
    expect(markdown).toContain("**F = ma 里 a 指什么？**")
    expect(markdown).toContain("- 加速度")
    expect(markdown).toContain("答案：加速度")
    expect(markdown).toContain("解析：a 是加速度。")
  })

  it("leaves out the sections nobody filled in", () => {
    // Ten headings with nine of them empty is a worse file than four filled ones.
    const markdown = lessonToMarkdown(
      lessonWith({
        sections: [
          { id: "objectives", type: "objectives", title: "学习目标", content: { markdown: "会判断。" } },
          { id: "mistakes", type: "common_mistakes", title: "常见错误", content: { markdown: "   " } },
        ],
      }),
    )

    expect(markdown).toContain("## 学习目标")
    expect(markdown).not.toContain("常见错误")
  })

  it("names an untitled course and an untitled section rather than leaving a blank heading", () => {
    const markdown = lessonToMarkdown(lessonWith({ title: "  ", sections: [{ id: "notes", type: "notes", content: { markdown: "正文。" } }] }))

    expect(markdown.startsWith("# 未命名课程")).toBe(true)
    expect(markdown).toContain("## notes")
  })
})