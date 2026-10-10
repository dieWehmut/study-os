import type { LessonSection } from "@/api/lessons"

import { sectionEditorText, sectionHasContent, sectionType } from "./lesson-content"

/**
 * What one revision changed about another.
 *
 * Versions are immutable, so "第 3 版 · 5 节有内容" answers how much a revision
 * holds but not what it changed -- and a reader looking for the version to go
 * back to is asking the second question. Sections are compared by kind (the
 * template is fixed) and by the lines they are written as.
 */
export interface LessonSectionDiff {
  type: string
  title: string
  change: "added" | "removed" | "changed" | "same"
  beforeLines: number
  afterLines: number
}

function readableLines(section: LessonSection): string[] {
  return sectionEditorText(section)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
}

function sameLines(before: string[], after: string[]): boolean {
  return before.length === after.length && before.every((line, index) => line === after[index])
}

export function compareLessonSections(before: LessonSection[], after: LessonSection[]): LessonSectionDiff[] {
  const beforeByType = new Map(before.map((section) => [sectionType(section), section]))
  const afterByType = new Map(after.map((section) => [sectionType(section), section]))
  const types = [...afterByType.keys(), ...[...beforeByType.keys()].filter((type) => !afterByType.has(type))]

  return types.map((type) => {
    const beforeSection = beforeByType.get(type)
    const afterSection = afterByType.get(type)
    const title = afterSection?.title || beforeSection?.title || type
    const beforeLines = beforeSection ? readableLines(beforeSection) : []
    const afterLines = afterSection ? readableLines(afterSection) : []
    const filledBefore = beforeSection ? sectionHasContent(beforeSection) : false
    const filledAfter = afterSection ? sectionHasContent(afterSection) : false

    let change: LessonSectionDiff["change"] = "same"
    if (!filledBefore && filledAfter) change = "added"
    else if (filledBefore && !filledAfter) change = "removed"
    else if (filledBefore && filledAfter && !sameLines(beforeLines, afterLines)) change = "changed"

    return { type, title, change, beforeLines: beforeLines.length, afterLines: afterLines.length }
  })
}

/** The sections that actually moved, for a summary that stays short. */
export function changedSections(diff: LessonSectionDiff[]): LessonSectionDiff[] {
  return diff.filter((section) => section.change !== "same")
}

export function describeChange(section: LessonSectionDiff): string {
  const delta = section.afterLines - section.beforeLines
  switch (section.change) {
    case "added":
      return `新增（${section.afterLines} 行）`
    case "removed":
      return `清空（原 ${section.beforeLines} 行）`
    default:
      return `${section.afterLines} 行${delta === 0 ? "（内容有改动）" : `（${delta > 0 ? "+" : ""}${delta}）`}`
  }
}