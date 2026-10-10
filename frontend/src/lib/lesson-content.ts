import type { LessonSection } from "@/api/lessons"

/**
 * Reading and writing a lesson section's content.
 *
 * A section's content is JSON, and the lesson page renders two shapes of it: a
 * list of lines (核心概念, 目标) and a block of text (可视化 as markdown, 总结 as
 * prose). The editor writes back the shape the section already had, so a saved
 * lesson keeps rendering the way the reader saw it.
 */

export function sectionType(section: LessonSection): string {
  return section.type || section.kind || "concept"
}

export function sectionContent(section: LessonSection): unknown {
  if (section.content !== undefined) return section.content
  if (section.body !== undefined) return section.body
  if (section.markdown !== undefined) return section.markdown
  if (section.summary !== undefined) return section.summary
  return ""
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function sectionText(section: LessonSection): string {
  const value = sectionContent(section)
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join("\n")
  const record = objectValue(value)
  for (const key of ["text", "body", "markdown", "prompt", "question"]) {
    if (typeof record[key] === "string") return record[key] as string
  }
  return section.body ?? section.markdown ?? section.summary ?? ""
}

export function sectionItems(section: LessonSection): string[] {
  if (section.items?.length) return section.items
  const value = sectionContent(section)
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  const record = objectValue(value)
  for (const key of ["items", "options"]) {
    const items = record[key]
    if (Array.isArray(items)) return items.filter((item): item is string => typeof item === "string")
  }
  return []
}

/** Does this section carry anything a learner can read? */
export function sectionHasContent(section: LessonSection): boolean {
  return sectionText(section).trim() !== "" || sectionItems(section).length > 0
}

/** How this section's text is stored, so an edit can write it back unchanged. */
export function sectionContentKind(section: LessonSection): "items" | "markdown" | "text" {
  if (section.items?.length) return "items"
  const record = objectValue(sectionContent(section))
  if (Array.isArray(record.items) || Array.isArray(record.options)) return "items"
  if (typeof record.markdown === "string" || section.markdown !== undefined) return "markdown"
  return "text"
}

/**
 * Whether the textarea can hold this section.
 *
 * 即时练习 is left out on purpose: it is a question with options and a right
 * answer, and a textarea would either break the grader or pretend the section is
 * prose. The other nine are text or a list of lines.
 */
export function isEditableSection(section: LessonSection): boolean {
  const type = sectionType(section)
  return type !== "practice" && type !== "quiz"
}

/** What the editor starts with: one line per item, otherwise the section's text. */
export function sectionEditorText(section: LessonSection): string {
  const items = sectionItems(section)
  if (items.length > 0) return items.join("\n")
  return sectionText(section)
}

/** The typed text, back as content the lesson page can render. */
export function sectionContentFromText(section: LessonSection, value: string): unknown {
  const lines = value.split("\n").map((line) => line.trim()).filter((line) => line !== "")
  if (sectionContentKind(section) === "items") return { items: lines }
  return { [sectionContentKind(section)]: lines.join("\n") }
}