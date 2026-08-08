import { parseOutline, type OutlineNode, type ParseOutlineOptions } from "./outline"

/** A single stopping point: small enough to hold in mind all at once. */
export interface ReadingChunk {
  id: string
  /** Headings from the document root down to this chunk. */
  path: string[]
  title: string
  lines: string[]
  /** First sentence, so the preview is identical every time. */
  gist: string
  /** Characters of prose, so the preview can show how heavy this is. */
  size: number
  /** True when the section was too long and this is a later part of it. */
  continues: boolean
}

export interface ChunkOptions extends ParseOutlineOptions {
  /** Characters of prose a single chunk may hold before it splits. */
  budget?: number
}

/**
 * Roughly a short paragraph of Chinese prose. Small enough to reread without
 * scrolling, which is what keeps a chunk holdable in one pass.
 */
export const defaultChunkBudget = 320

const sentenceEnd = /[。！？；!?;]/

/**
 * Bullets are points inside a section, not sections of their own -- promoting
 * each to a chunk would bury the reader in one-line stops. Their nested
 * children come along, so a sub-bullet is not silently dropped.
 */
function sectionLines(node: OutlineNode): string[] {
  const lines = [...node.body]
  for (const child of node.children) {
    if (child.kind !== "item") continue
    lines.push(child.title, ...sectionLines(child))
  }
  return lines
}

function gistOf(lines: string[]): string {
  const first = lines[0] ?? ""
  const end = first.search(sentenceEnd)
  return end === -1 ? first : first.slice(0, end + 1)
}

/** Splits on the budget but never inside a line: a half-sentence is unreadable. */
function packIntoChunks(node: OutlineNode, path: string[], lines: string[], budget: number): ReadingChunk[] {
  const chunks: ReadingChunk[] = []
  let current: string[] = []
  let size = 0

  const flush = () => {
    if (current.length === 0) return
    chunks.push({
      id: `${node.id}-p${chunks.length}`,
      path,
      title: node.title,
      lines: current,
      gist: gistOf(current),
      size,
      continues: chunks.length > 0,
    })
    current = []
    size = 0
  }

  for (const line of lines) {
    // A single over-budget line still has to land somewhere, so only break
    // when something is already held.
    if (current.length > 0 && size + line.length > budget) flush()
    current.push(line)
    size += line.length
  }
  flush()
  return chunks
}

function walk(node: OutlineNode, ancestors: string[], budget: number, out: ReadingChunk[]): void {
  const path = node.title ? [...ancestors, node.title] : ancestors
  const lines = sectionLines(node)
  // A heading that only groups other headings has nothing to read in it.
  if (lines.length > 0) out.push(...packIntoChunks(node, path, lines, budget))
  for (const child of node.children) {
    if (child.kind === "item") continue
    walk(child, path, budget, out)
  }
}

export function chunkMarkdown(markdown: string, options: ChunkOptions = {}): ReadingChunk[] {
  const budget = Math.max(1, options.budget ?? defaultChunkBudget)
  const chunks: ReadingChunk[] = []
  walk(parseOutline(markdown, options), [], budget, chunks)
  return chunks
}
