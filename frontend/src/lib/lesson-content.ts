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
  // A practice section that asks its questions in `questions` carries plenty, and
  // the flat fields it does not use would have said it was empty: the export
  // skipped the whole section.
  if (practiceQuestionsOf(section).length > 0) return true
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

/**
 * 即时练习 is a question with options and one right answer, so it is edited as
 * fields rather than as a textarea -- and the answer key is *chosen from* the
 * options, because a key that matches no option grades every attempt wrong while
 * looking finished.
 */
export interface LessonPracticeDraft {
  question: string
  /** One option per line, as typed. */
  optionsText: string
  correctAnswer: string
  explanation: string
  /**
   * The questions after the first, which stay in the flat fields above.
   *
   * Additive on purpose: every reader of a draft (the textareas, the "has anything
   * changed" check, the tests) keeps working unchanged, and a single-question
   * lesson never grows a second shape.
   */
  more?: LessonPracticeDraftFields[]
}

/** One question's fields, without the list that carries the rest. */
export interface LessonPracticeDraftFields {
  question: string
  optionsText: string
  correctAnswer: string
  explanation: string
}

export function practiceOptions(draft: LessonPracticeDraft): string[] {
  return draft.optionsText.split("\n").map((line) => line.trim()).filter((line) => line !== "")
}

function practiceRecord(section: LessonSection): Record<string, unknown> {
  const value = sectionContent(section)
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** The questions a section lists, when it uses the multi-question shape. */
export function practiceQuestionsOf(section: LessonSection): Record<string, unknown>[] {
  const questions = practiceRecord(section).questions
  if (!Array.isArray(questions)) return []
  return questions.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
  )
}

/** A question's own fields, or the section's when it uses the flat shape. */
function practiceAnswerText(record: Record<string, unknown>): string {
  for (const key of ["correct_answer", "correctAnswer", "answer"]) {
    const value = record[key]
    if (typeof value === "string") return value.trim()
    if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim()
    if (typeof value === "number") return String(value)
  }
  return ""
}

export function practiceDraftFromSection(section: LessonSection): LessonPracticeDraft {
  const records = practiceQuestionsOf(section)
  const [first, ...rest] = records.length > 0 ? records : [practiceRecord(section)]
  const draft: LessonPracticeDraft = practiceFieldsFromRecord(first ?? {}, records.length === 0 ? section : undefined)
  if (rest.length > 0) draft.more = rest.map((record) => practiceFieldsFromRecord(record))
  return draft
}

/** One question's editable fields, read from its stored content. */
function practiceFieldsFromRecord(record: Record<string, unknown>, section?: LessonSection): LessonPracticeDraftFields {
  const question = typeof record.question === "string"
    ? record.question
    : typeof record.prompt === "string"
      ? record.prompt
      : typeof record.stem === "string" ? record.stem : ""
  const rawOptions = record.options
  const options = Array.isArray(rawOptions)
    ? rawOptions.map((option) => (typeof option === "string" ? option : "")).filter(Boolean)
    : section ? sectionItems(section) : []
  return {
    question,
    optionsText: options.join("\n"),
    correctAnswer: practiceAnswerText(record),
    explanation: typeof record.explanation === "string" ? record.explanation : "",
  }
}

/** A blank question, for 「再加一题」. */
export function blankPracticeDraft(): LessonPracticeDraftFields {
  return { question: "", optionsText: "", correctAnswer: "", explanation: "" }
}

/** One question's fields as the stored shape. */
function practiceContentFromFields(fields: LessonPracticeDraftFields): Record<string, unknown> {
  const options = fields.optionsText.split("\n").map((line) => line.trim()).filter((line) => line !== "")
  const content: Record<string, unknown> = { question: fields.question.trim(), options }
  // Only an answer that is one of the options: anything else cannot be graded.
  if (fields.correctAnswer && options.includes(fields.correctAnswer)) content.correct_answer = fields.correctAnswer
  const explanation = fields.explanation.trim()
  if (explanation) content.explanation = explanation
  return content
}

export function practiceContentFromDraft(draft: LessonPracticeDraft, section?: LessonSection): unknown {
  const first = practiceContentFromFields(draft)
  const more = draft.more ?? []

  // A section that asks several questions keeps them all. Writing the flat shape
  // here is what made 保存 quietly delete the ones the editor could not show.
  if (more.length > 0 || practiceQuestionsOf(section ?? { id: "", type: "", title: "" }).length > 0) {
    const stored = practiceQuestionsOf(section ?? { id: "", type: "", title: "" })
    const firstID = typeof stored[0]?.id === "string" ? stored[0].id : ""
    const questions: Record<string, unknown>[] = [{ ...first, ...(firstID ? { id: firstID } : {}), ...(firstID ? {} : { id: "q1" }) }]
    more.forEach((fields, index) => {
      const storedID = typeof stored[index + 1]?.id === "string" ? stored[index + 1].id : ""
      questions.push({ ...practiceContentFromFields(fields), id: storedID || `q${index + 2}` })
    })
    return { questions }
  }
  return first
}

/** Is this a question someone could actually answer? */
export function practiceDraftComplete(draft: LessonPracticeDraft): boolean {
  const complete = (fields: LessonPracticeDraftFields) =>
    fields.question.trim() !== "" && fields.optionsText.split("\n").some((line) => line.trim() !== "")
  return complete(draft) && (draft.more ?? []).every(complete)
}