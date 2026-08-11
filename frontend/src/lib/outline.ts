/**
 * Deterministic markdown -> outline tree.
 *
 * Structure is derived entirely from the document: heading levels and list
 * indentation. No model is involved, which is the point -- a language model may
 * write the prose inside a section, but it must never decide the shape of the
 * tree, or the same source would produce a different map on every run and the
 * structure would stop being something you can trust before reading.
 */

/**
 * A section is somewhere you can stop reading; an item is a point inside one.
 * Depth alone cannot tell them apart once the tree is built, and they want
 * different treatment when chunking and when drawing.
 */
export type OutlineKind = "root" | "heading" | "item"

export interface OutlineNode {
  /** Stable across runs: derived from the node's position in the document. */
  id: string
  title: string
  kind: OutlineKind
  /** 0 for the root; heading level or list depth below it. */
  depth: number
  /**
   * Which source line this node's title was written on, or -1 for a title that
   * was handed in rather than read out of the document.
   *
   * This is what makes the tree writable. An edit to a node has to land back in
   * the markdown, and rebuilding the document from the tree would rewrite
   * everything the parser does not model -- blank lines, list markers, the
   * prose itself. Addressing the single line instead keeps the rest byte-equal.
   */
  line: number
  /** Prose lines introduced under this node, in document order. */
  body: string[]
  children: OutlineNode[]
}

export interface ParseOutlineOptions {
  /** Used when the document has no leading level-1 heading of its own. */
  title?: string
}

/**
 * Shared with the editor, which has to recognise exactly what the parser did.
 * Two copies would drift, and the failure is silent in the worst direction: the
 * map offers a node for renaming and the write then refuses the line it sits on.
 *
 * The list marker is captured rather than skipped so an edit can put it back --
 * `1.` and `-` are not interchangeable, and the indent before it is what depth
 * is read from.
 */
export const headingPattern = /^(#{1,6})\s+(.*)$/
export const listPattern = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
/** Two spaces per level is the CommonMark-ish convention; a tab counts as one. */
const indentWidth = 2

/**
 * Split a table row into its cells.
 *
 * Escaped bars are put back rather than split on, because `\|x\|` is how a cell
 * writes an absolute value -- splitting there would cut one cell into three and
 * shift every column after it under the wrong header. The outer pipes are
 * optional, as GFM makes them, and both forms turn up in real material.
 */
export function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return trimmed
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim())
}

/**
 * The `| --- | :--: |` line under a table's header.
 *
 * Its presence is what makes the lines around it a table at all. Without that
 * requirement any sentence containing a bar -- `|x|`, `A | B` -- would be read
 * as columns, and the map would shred the prose it was supposed to summarise.
 */
export function isTableDelimiter(line: string): boolean {
  if (!/\|/.test(line)) return false
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

interface OpenNode {
  node: OutlineNode
  depth: number
}

function emptyNode(title: string, depth: number, kind: OutlineKind, line: number): OutlineNode {
  return { id: "", title, kind, depth, line, body: [], children: [] }
}

/**
 * Re-parents to the nearest still-open ancestor rather than the exact parent
 * level. Hand-written study material skips levels constantly (h1 straight to
 * h3); treating that as malformed would drop whole sections.
 */
function appendAt(stack: OpenNode[], node: OutlineNode): void {
  while (stack.length > 1 && stack[stack.length - 1].depth >= node.depth) stack.pop()
  stack[stack.length - 1].node.children.push(node)
  stack.push({ node, depth: node.depth })
}

function assignIds(node: OutlineNode, path: string): void {
  node.id = path
  node.children.forEach((child, index) => assignIds(child, `${path}-${index}`))
}

export function parseOutline(markdown: string, options: ParseOutlineOptions = {}): OutlineNode {
  // -1, not 0: a handed-in title was never written in this document, so there
  // is no line an edit to it could land on.
  const root = emptyNode(options.title ?? "", 0, "root", -1)
  const stack: OpenNode[] = [{ node: root, depth: 0 }]
  // List depth is measured from the enclosing heading, not from the stack top,
  // so a nested list under a deep heading keeps its own relative shape.
  let headingDepth = 0

  const source = markdown.split("\n")
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index].trimEnd()
    if (line.trim() === "") continue

    const heading = headingPattern.exec(line)
    if (heading) {
      const depth = heading[1].length
      const title = heading[2].trim()
      // The document's opening heading can be the document's own name rather
      // than a section of it, in two ways: an unclaimed `# X` names a document
      // that arrived without a title, and a heading at any level repeating a
      // title we were handed is that same name written twice. Wiki entries are
      // the second case -- each is written *about* a term and so opens
      // "## <term>" -- and treating either as a section produces a lone branch
      // that every other section then hangs beside.
      const opening = root.body.length === 0 && root.children.length === 0
      if (opening && (depth === 1 ? !root.title : title === root.title)) {
        root.title = title
        // The root now does own a line -- this one -- even when it was seeded
        // from `options.title`, because the document repeats that title here.
        root.line = index
        headingDepth = depth
        continue
      }
      appendAt(stack, emptyNode(title, depth, "heading", index))
      headingDepth = depth
      continue
    }

    const item = listPattern.exec(line)
    if (item) {
      const indent = item[1].replace(/\t/g, " ".repeat(indentWidth)).length
      const itemDepth = headingDepth + 1 + Math.floor(indent / indentWidth)
      appendAt(stack, emptyNode(item[3].trim(), itemDepth, "item", index))
      continue
    }

    // A table is structure, not prose: its rows are the things being compared,
    // which is exactly what a map is for (0807:75 -- a markdown wiki becomes a
    // map by a fixed program, and a comparison table is the densest structure
    // 教辅 material has). Left in the body it reaches the reader as raw pipe
    // syntax inside a note panel, the one form less readable than the table.
    //
    // Recognised by looking ahead for the alignment row rather than by the bars
    // alone, because bars are ordinary punctuation in study material.
    if (/\|/.test(line) && index + 1 < source.length && isTableDelimiter(source[index + 1].trimEnd())) {
      const header = splitTableRow(line)
      // The header and the alignment row are the table's frame, not its
      // contents, so neither becomes a node -- but the header's words are what
      // name the fields on every row below it.
      let cursor = index + 2
      const rowDepth = headingDepth + 1
      while (cursor < source.length) {
        const row = source[cursor].trimEnd()
        if (row.trim() === "" || !/\|/.test(row)) break
        const cells = splitTableRow(row)
        // The first cell is the row's subject; the rest is what the table says
        // about it, kept as prose under the node rather than as more nodes --
        // a map whose leaves are single table cells is the table again, worse.
        const node = emptyNode(cells[0] ?? "", rowDepth, "item", cursor)
        node.body = cells
          .slice(1)
          // Empty cells are dropped rather than written as "例子：": half-filled
          // tables are normal, and a bare label reads as a missing answer.
          .map((cell, column) => (cell ? `${header[column + 1] ?? ""}：${cell}`.replace(/^：/, "") : ""))
          .filter(Boolean)
        appendAt(stack, node)
        cursor += 1
      }
      // -1 because the loop's own increment supplies the last step.
      index = cursor - 1
      continue
    }

    stack[stack.length - 1].node.body.push(line.trim())
  }

  assignIds(root, "n0")
  return root
}

/** Depth-first, so the sequence matches the order the document reads in. */
export function flattenOutline(root: OutlineNode): OutlineNode[] {
  return [root, ...root.children.flatMap((child) => flattenOutline(child))]
}
