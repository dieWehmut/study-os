export const readingStorageKey = "study-os.reading"

/** Where the reader is in one document, and which stops are behind them. */
export interface ReadingSession {
  markdown: string
  index: number
  readIds: string[]
}

export const emptyReadingSession: ReadingSession = { markdown: "", index: 0, readIds: [] }

function normalizeIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

/**
 * Read back the document, the place and the marks as one fact.
 *
 * They are one fact because a mark names a chunk id, and chunk ids are derived
 * from the document's own shape. Marks restored without the text they were
 * made against would land on stops nobody has read, and a place restored into
 * an empty box would be stop 3 of nothing -- so a session with no document is
 * no session, marks and all.
 */
export function readReadingSession(): ReadingSession {
  if (typeof localStorage === "undefined") return emptyReadingSession

  try {
    const raw = localStorage.getItem(readingStorageKey)
    if (!raw) return emptyReadingSession
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return emptyReadingSession

    const session = parsed as Record<string, unknown>
    if (typeof session.markdown !== "string" || session.markdown === "") {
      return emptyReadingSession
    }

    return {
      markdown: session.markdown,
      index: normalizeIndex(session.index),
      readIds: Array.isArray(session.readIds)
        ? session.readIds.filter((id): id is string => typeof id === "string")
        : [],
    }
  } catch {
    return emptyReadingSession
  }
}

export function writeReadingSession(session: ReadingSession): void {
  if (typeof localStorage === "undefined") return
  try {
    // Clearing the box is an instruction, not an empty save: leaving the old
    // document on disk would hand it back the next time you opened the page.
    if (session.markdown === "") {
      localStorage.removeItem(readingStorageKey)
      return
    }
    localStorage.setItem(readingStorageKey, JSON.stringify(session))
  } catch {
    // Best-effort: a full or blocked store must not cost you the page you are
    // still reading.
  }
}
