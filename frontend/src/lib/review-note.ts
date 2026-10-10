export interface PracticeNoteInput {
  question: string
  /** The text of the correct option, when the question has a registered answer. */
  answerLabel?: string
  /** What the reader picked this time. */
  picked?: string
  explanation?: string
}

/**
 * The notes these pages file as review cards.
 *
 * One shape, because the library names an item by the opening of its text and the
 * card is asked by that name: whatever is being remembered goes first, then a
 * blank line, then the prose that answers it. A note written the other way round
 * gets asked by the opening of its own answer.
 */
export function practiceNote({ question, answerLabel, picked, explanation }: PracticeNoteInput): string {
  return [
    question.trim(),
    "",
    answerLabel ? `正确答案：${answerLabel}` : "标准答案：未登记",
    picked ? `当时选的：${picked}` : "",
    explanation ? `解析：${explanation}` : "",
  ]
    .filter((line, index) => index === 1 || line.trim() !== "")
    .join("\n")
}

/** One 整合 card: its title is the question, its body the answer. */
export function cardNote(title: string, body: string): string {
  return [title.trim(), "", body.trim()].join("\n")
}

/** One answer from 答疑: the question that was asked, then what came back. */
export function answerNote(question: string, answer: string): string {
  return [question.trim(), "", answer.trim()].join("\n")
}