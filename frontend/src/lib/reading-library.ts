import {
  normalizeIds,
  normalizeIndex,
  type ReadingSession,
} from "./reading-session"

export const readingLibraryStorageKey = "study-os.reading-library"

/**
 * How many documents the shelf keeps.
 *
 * The shelf is a list you scan to find what to go back to, not an archive.
 * Past a dozen you are searching rather than choosing, and every entry carries
 * the whole document, so an uncapped shelf would eventually fill the store and
 * cost you the save of whatever you are reading right now.
 */
const shelfLimit = 12

/** A document you put away, with everything you had marked on it. */
export interface ShelvedDocument extends ReadingSession {
  id: string
  shelvedAt: number
}

/**
 * Two documents put away in the same millisecond still have to be told apart,
 * or a 打开 lands on the row next to the one you clicked.
 */
let shelvedThisSession = 0

function nextId(): string {
  shelvedThisSession += 1
  return `${Date.now().toString(36)}-${shelvedThisSession.toString(36)}`
}

/**
 * Read one row back, or refuse it.
 *
 * A row with no id cannot be opened or removed, and a row with no text is a
 * blank entry on a shelf whose whole job is to say what is on it -- better to
 * lose the row than to show one the page cannot describe.
 */
function toShelved(value: unknown): ShelvedDocument | null {
  if (typeof value !== "object" || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== "string" || row.id === "") return null
  if (typeof row.markdown !== "string" || row.markdown.trim() === "") return null

  return {
    id: row.id,
    shelvedAt: typeof row.shelvedAt === "number" && Number.isFinite(row.shelvedAt) ? row.shelvedAt : 0,
    markdown: row.markdown,
    index: normalizeIndex(row.index),
    readIds: normalizeIds(row.readIds),
    stuckIds: normalizeIds(row.stuckIds),
  }
}

/** The documents you put away, the one you closed most recently first. */
export function readShelf(): ShelvedDocument[] {
  if (typeof localStorage === "undefined") return []

  try {
    const raw = localStorage.getItem(readingLibraryStorageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((entry) => {
      const row = toShelved(entry)
      return row ? [row] : []
    })
  } catch {
    return []
  }
}

function writeShelf(shelf: ShelvedDocument[]): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(readingLibraryStorageKey, JSON.stringify(shelf))
  } catch {
    // Best-effort: a full or blocked store must not cost you the document you
    // are still holding on screen.
  }
}

/**
 * Put a document away, marks and all.
 *
 * The marks go with it because they are the work; the text is only the input.
 * An empty box is not a document, so closing one is nothing to keep -- and
 * shelving it would push a real document off the end for nothing.
 */
export function shelveDocument(session: ReadingSession): ShelvedDocument[] {
  if (session.markdown.trim() === "") return readShelf()

  const shelf = [
    { ...session, id: nextId(), shelvedAt: Date.now() },
    ...readShelf(),
  ].slice(0, shelfLimit)

  writeShelf(shelf)
  return shelf
}

/**
 * Take a document back off the shelf.
 *
 * It leaves the shelf on the way out: a document is either open or put away,
 * never both, which is what keeps the shelf from showing you a stale copy of
 * the thing you are reading.
 */
/**
 * Throw a document away for good.
 *
 * The shelf is a list you scan to choose from, so one you will not read again
 * costs you every time you look at it. There is no undo, which is why the cap
 * evicts silently but this does not: dropping the oldest of thirteen is
 * housekeeping, and this is a decision.
 */
export function forgetDocument(id: string): ShelvedDocument[] {
  const shelf = readShelf().filter((entry) => entry.id !== id)
  writeShelf(shelf)
  return shelf
}

export function restoreDocument(id: string): ReadingSession | null {
  const shelf = readShelf()
  const wanted = shelf.find((entry) => entry.id === id)
  if (!wanted) return null

  writeShelf(shelf.filter((entry) => entry.id !== id))
  return {
    markdown: wanted.markdown,
    index: wanted.index,
    readIds: wanted.readIds,
    stuckIds: wanted.stuckIds,
  }
}
