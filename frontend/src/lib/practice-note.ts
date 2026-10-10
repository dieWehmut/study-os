export interface PracticeNoteInput {
  question: string
  /** The text of the correct option, when the question has a registered answer. */
  answerLabel?: string
  /** What the reader picked this time. */
  picked?: string
  explanation?: string
}

/**
 * A wrong answer as a note to remember.
 *
 * The question leads, because the library names an item by its opening and the
 * card is asked by that name: an answer-first note would be asked by the opening
 * of its own explanation. Then what the answer was, what was picked, and why --
 * the three things that make the card worth asking again.
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