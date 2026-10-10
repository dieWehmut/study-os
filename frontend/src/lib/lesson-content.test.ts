import { describe, expect, it } from "vitest"

import type { LessonSection } from "@/api/lessons"
import {
  isEditableSection,
  sectionContentFromText,
  sectionEditorText,
  sectionHasContent,
  sectionItems,
  sectionText,
} from "./lesson-content"

function section(value: Partial<LessonSection>): LessonSection {
  return { id: value.id ?? "s", type: value.type ?? "concept", title: value.title ?? "标题", ...value }
}

describe("lesson content", () => {
  it("reads an items section as lines and writes it back as items", () => {
    // 核心概念 is written by the lesson generator as {items:[...]}, and the editor
    // must not turn it into prose on the way back or the page stops listing it.
    const concept = section({ type: "concept", content: { items: ["速度", "加速度"] } })

    expect(sectionItems(concept)).toEqual(["速度", "加速度"])
    expect(sectionEditorText(concept)).toBe("速度\n加速度")
    expect(sectionContentFromText(concept, "速度\n加速度\n合力")).toEqual({ items: ["速度", "加速度", "合力"] })
  })

  it("keeps a markdown section markdown, and trims blank lines", () => {
    const visualization = section({ type: "visualization", content: { markdown: "- 速度\n- 加速度" } })

    expect(sectionEditorText(visualization)).toBe("- 速度\n- 加速度")
    expect(sectionContentFromText(visualization, "- 速度\n\n  \n- 合力")).toEqual({ markdown: "- 速度\n- 合力" })
  })

  it("falls back to a plain text section", () => {
    const summary = section({ type: "summary", content: {} })

    expect(sectionEditorText(summary)).toBe("")
    expect(sectionHasContent(summary)).toBe(false)
    expect(sectionContentFromText(summary, "合外力决定加速度。")).toEqual({ text: "合外力决定加速度。" })
  })

  it("still reads the first draft's shapes", () => {
    // A lesson written before the document envelope existed keeps its body.
    const legacy = section({ type: "summary", body: "一句话总结" })

    expect(sectionText(legacy)).toBe("一句话总结")
    expect(sectionEditorText(legacy)).toBe("一句话总结")
  })

  it("leaves 即时练习 out of the textarea", () => {
    // It is a question with options and a right answer: a textarea would either
    // break the grader or pretend the section is prose.
    const practice = section({ type: "practice", content: { question: "F = ?", options: ["1 N", "8 N"] } })

    expect(isEditableSection(practice)).toBe(false)
    expect(isEditableSection(section({ type: "concept" }))).toBe(true)
    // The options are still readable as items, which is what the page shows.
    expect(sectionItems(practice)).toEqual(["1 N", "8 N"])
  })
})