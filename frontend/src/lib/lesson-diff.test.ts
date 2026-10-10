import { describe, expect, it } from "vitest"

import type { LessonSection } from "@/api/lessons"
import { changedSections, compareLessonSections, describeChange } from "./lesson-diff"

function section(type: string, title: string, content?: unknown): LessonSection {
  return content === undefined ? { id: type, type, title } : { id: type, type, title, content }
}

describe("comparing two revisions of a lesson", () => {
  it("says what each section gained, lost, or changed", () => {
    const before = [
      section("diagnostic", "诊断", {}),
      section("concept", "核心概念", { items: ["速度"] }),
      section("summary", "总结", { text: "一句话" }),
    ]
    const after = [
      section("diagnostic", "诊断", {}),
      section("concept", "核心概念", { items: ["速度", "加速度"] }),
      section("summary", "总结", {}),
    ]

    const diff = compareLessonSections(before, after)

    expect(diff.map((entry) => [entry.type, entry.change])).toEqual([
      ["diagnostic", "same"],
      ["concept", "changed"],
      ["summary", "removed"],
    ])
    // Only what moved is worth showing.
    expect(changedSections(diff).map((entry) => entry.type)).toEqual(["concept", "summary"])
    expect(describeChange(changedSections(diff)[0])).toBe("2 行（+1）")
    expect(describeChange(changedSections(diff)[1])).toBe("清空（原 1 行）")
  })

  it("counts a section that arrived as new", () => {
    const diff = compareLessonSections(
      [section("concept", "核心概念")],
      [section("concept", "核心概念"), section("visualization", "可视化", { markdown: "- 一节\n- 二节" })],
    )

    expect(diff.map((entry) => entry.change)).toEqual(["same", "added"])
    expect(describeChange(diff[1])).toBe("新增（2 行）")
  })

  it("reads the same content written in the same order as unchanged", () => {
    // Whitespace and blank lines are how the textarea is typed, not what it says.
    const diff = compareLessonSections(
      [section("summary", "总结", { text: "第一句\n\n第二句" })],
      [section("summary", "总结", { text: " 第一句 \n第二句\n" })],
    )

    expect(diff[0].change).toBe("same")
  })

  it("sees a reordering as a change", () => {
    const diff = compareLessonSections(
      [section("concept", "核心概念", { items: ["甲", "乙"] })],
      [section("concept", "核心概念", { items: ["乙", "甲"] })],
    )

    expect(diff[0].change).toBe("changed")
    expect(describeChange(diff[0])).toBe("2 行（内容有改动）")
  })

  it("reports a section that only one revision has", () => {
    const diff = compareLessonSections(
      [section("legacy", "旧版小节", { text: "只剩它" }), section("concept", "核心概念", { items: ["甲"] })],
      [section("concept", "核心概念", { items: ["甲"] })],
    )

    expect(diff.map((entry) => [entry.type, entry.change])).toEqual([["concept", "same"], ["legacy", "removed"]])
  })
})