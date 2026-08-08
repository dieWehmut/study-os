import type { ReadingChunk } from "./chunk"

export const askDraftStorageKey = "study-os.ask-draft"

/**
 * Turn the sections that did not land into something answerable.
 *
 * Whoever answers never saw the document, so the headings alone are titles
 * with no text under them. The section's own words go along, and so does its
 * place in the document -- for the same reason the reader keeps the heading
 * path above the prose: a section read out of its document is just a sentence.
 */
export function buildStuckQuestion(chunks: ReadingChunk[]): string {
  if (chunks.length === 0) return ""

  const sections = chunks.map((chunk) => {
    const where = chunk.path.join(" / ")
    return [`## ${where}`, ...chunk.lines].join("\n")
  })

  return [`下面这 ${chunks.length} 节我没看懂，帮我讲一下：`, ...sections].join("\n\n")
}

/** Leave a question for 答疑 to pick up. A blank one is nothing to carry. */
export function putAskDraft(question: string): void {
  if (typeof localStorage === "undefined") return
  try {
    if (question.trim() === "") {
      localStorage.removeItem(askDraftStorageKey)
      return
    }
    localStorage.setItem(askDraftStorageKey, question)
  } catch {
    // Best-effort: a full or blocked store must not cost you the page you are
    // still reading.
  }
}

/**
 * Collect the question that was left, and clear it.
 *
 * Taking is deliberately not peeking. The draft is a handoff between two
 * pages, not a store; one that survived being read would turn up weeks later
 * on an unrelated visit to 答疑.
 */
export function takeAskDraft(): string {
  if (typeof localStorage === "undefined") return ""
  try {
    const question = localStorage.getItem(askDraftStorageKey)
    localStorage.removeItem(askDraftStorageKey)
    return question ?? ""
  } catch {
    return ""
  }
}
