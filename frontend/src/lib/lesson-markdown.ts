import { sectionEditorText, sectionHasContent, sectionItems, sectionType } from "./lesson-content"
import type { Lesson } from "@/api/lessons"

/**
 * One course, as the Markdown the app itself reads.
 *
 * A lesson is a document: ten named sections with prose, lists and a question in
 * them. Everything else in this app can leave it -- 知识库 exports as a table --
 * while a course could only be read on its own page.
 *
 * The section's stored shape decides how it is written: items become a list, so a
 * round trip through any editor does not turn three bullets into one paragraph.
 * Raw `markdown` sections are passed through as they are, because they already
 * are Markdown and re-indenting them would change them.
 */
export function lessonToMarkdown(lesson: Lesson): string {
  const lines: string[] = [`# ${lesson.title.trim() || "未命名课程"}`]
  const meta = [lesson.subject && lesson.subject !== "all" ? `学科：${lesson.subject}` : "", lesson.status ? `状态：${lesson.status}` : ""]
    .filter(Boolean)
    .join(" · ")
  if (meta) lines.push("", meta)

  for (const section of lesson.sections) {
    if (!sectionHasContent(section)) continue
    lines.push("", `## ${section.title?.trim() || sectionType(section)}`, "")
    lines.push(renderSection(section))
  }
  return `${lines.join("\n").trimEnd()}\n`
}

function renderSection(section: Lesson["sections"][number]): string {
  // 即时练习 is a question, not prose: writing it as a list of options loses the
  // answer, and writing the answer into the same block would give it away on a
  // printed page.
  if (sectionType(section) === "practice") {
    const practice = practiceLines(section)
    return practice.length > 0 ? practice.join("\n") : sectionEditorText(section).trim()
  }
  const text = sectionEditorText(section).trim()
  if (text === "") return ""
  const bullets = sectionItems(section).length > 0
  return bullets ? text.split("\n").map((line) => `- ${line.trim()}`).join("\n") : text
}

/** The question, its options and the standard answer, as they would be printed. */
function practiceLines(section: Lesson["sections"][number]): string[] {
  const content = section.content
  if (!content || typeof content !== "object" || Array.isArray(content)) return []
  const record = content as Record<string, unknown>
  // `questions` is the source when a section asks several. Reading only the flat
  // fields exported such a section as nothing at all -- the same gap the practice
  // panel had, and just as quiet.
  const questions = Array.isArray(record.questions)
    ? record.questions.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
    )
    : []
  if (questions.length > 0) {
    return questions.flatMap((question, index) => {
      const lines = practiceLinesFor(question, questions.length > 1 ? index + 1 : 0)
      return index === 0 ? lines : ["", ...lines]
    })
  }
  return practiceLinesFor(record, 0)
}

/** One question's lines. The number is only printed when a section asks several. */
function practiceLinesFor(record: Record<string, unknown>, number: number): string[] {
  const question = typeof record.question === "string" ? record.question.trim() : ""
  if (!question) return []
  const options = Array.isArray(record.options) ? record.options.filter((option): option is string => typeof option === "string") : []
  const answer = typeof record.correct_answer === "string" ? record.correct_answer.trim() : ""
  const explanation = typeof record.explanation === "string" ? record.explanation.trim() : ""
  return [
    `**${number > 0 ? `${number}. ` : ""}${question}**`,
    ...options.map((option) => `- ${option}`),
    answer ? `\n答案：${answer}` : "",
    explanation ? `解析：${explanation}` : "",
  ].filter((line) => line !== "")
}