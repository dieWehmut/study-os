import { chunkMarkdown } from "./chunk"
import { parseOutline } from "./outline"

export const readingStorageKey = "study-os.reading"

const untitledDocument = "未命名文档"

/** Where the reader is in one document, and which stops are behind them. */
export interface ReadingSession {
  markdown: string
  index: number
  readIds: string[]
  /**
   * Stops that were read and still did not land. Kept apart from readIds
   * because both can be true of the same stop at once -- finishing a section
   * and understanding it are different facts about it.
   */
  stuckIds: string[]
}

export const emptyReadingSession: ReadingSession = {
  markdown: "",
  index: 0,
  readIds: [],
  stuckIds: [],
}

function normalizeIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

function normalizeIds(value: unknown): string[] {
  // A missing list is no marks, not a broken session: sessions on disk predate
  // the field, and refusing them would empty the box of whoever had a document
  // open when the app updated.
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
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
      readIds: normalizeIds(session.readIds),
      stuckIds: normalizeIds(session.stuckIds),
    }
  } catch {
    return emptyReadingSession
  }
}

/** What is worth saying about a half-read document from somewhere else. */
export interface ReadingSummary {
  title: string
  total: number
  read: number
  remaining: number
  /**
   * Stops that were read and still did not land. Carried alongside the read
   * count because it answers a different question: how far you got, versus
   * whether going back is worth it.
   */
  stuck: number
}

/**
 * Describe a session well enough for another page to offer to resume it.
 *
 * The counts are recomputed from the document rather than stored, because the
 * marks and the text drift apart the moment you edit: a mark naming a stop
 * this draft no longer has must not push "已读" past the number of stops that
 * exist. Text that produces no stops is nothing to go back to, so it is no
 * summary at all rather than a card reading 0 / 0.
 */
export function summarizeReadingSession(session: ReadingSession): ReadingSummary | null {
  const chunks = chunkMarkdown(session.markdown)
  if (chunks.length === 0) return null

  const stops = new Set(chunks.map((chunk) => chunk.id))
  const read = new Set(session.readIds.filter((id) => stops.has(id))).size
  const stuck = new Set(session.stuckIds.filter((id) => stops.has(id))).size

  return {
    title: parseOutline(session.markdown).title || untitledDocument,
    total: chunks.length,
    read,
    remaining: chunks.length - read,
    stuck,
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
