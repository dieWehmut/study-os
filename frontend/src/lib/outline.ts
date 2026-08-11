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
  /**
   * Whether this node was written with a number rather than a bullet.
   *
   * The list marker is otherwise thrown away, and with it the one thing that
   * tells a 流程 apart from a 并列: `structures.md` §1.1 derives 流程 from 并列 by
   * adding arrows and numbering, and numbering is the half that survives into
   * plain markdown. False for headings and table rows, which are not list items
   * at all -- reading a numbered heading as a step would turn every 教辅 chapter
   * into a flowchart.
   */
  ordered: boolean
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
 * A fence line: ``` or ~~~ , three or more, with an optional info string.
 *
 * Both characters are matched because a tilde fence is how you show markdown
 * that itself contains backticks, and 教辅 material about markdown does exactly
 * that. The marker is captured so a close can be required to match its open.
 */
const fencePattern = /^(\s*)(`{3,}|~{3,})(.*)$/

/**
 * Where the fence opened at `start - 1` closes, or -1 if it never does.
 *
 * Looked up before the fence is honoured, rather than discovered by running to
 * the end of the document. CommonMark ends an unclosed fence at end of input,
 * which here would mean one stray ``` in a wiki truncated mid-sample collapses
 * every section after it into prose -- the map would lose its shape at exactly
 * the moment the reader needs it most. Requiring the close first makes a
 * half-written fence degrade to what the parser did before fences existed.
 */
function fenceClose(source: string[], start: number, marker: string): number {
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const candidate = fencePattern.exec(source[cursor].trimEnd())
    // Same character, at least as long, and nothing after it: an info string is
    // what makes a fence an opening one, so ```python can never be a close.
    if (
      candidate &&
      candidate[2][0] === marker[0] &&
      candidate[2].length >= marker.length &&
      candidate[3].trim() === ""
    ) {
      return cursor
    }
  }
  return -1
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

/**
 * How many characters still read as a name rather than as a sentence.
 *
 * A label is drawn on one line and every descendant column is pushed right by
 * its full width, so a paragraph in a box does not merely look wrong -- it
 * shoves the rest of the branch off the canvas. 24 is about a headline.
 */
const nameBudget = 24

/**
 * A colon inside running prose, told apart from a field name before one.
 *
 * A subject is a fragment. Something that ends a sentence appearing before the
 * colon means the colon belongs to the prose -- 「…写完了一整句话。然后它继续解释：」
 * is one thought, not a label. ASCII `.` `!` `?` are deliberately absent: here
 * they are decimals, version numbers and `render(shell?)` far more often than
 * they are punctuation.
 */
const sentenceEnd = /[。！？；;]/

/**
 * Split `主题：说明` into the name and what is said under it.
 *
 * 1688 of the 3657 list items in sample/distill are written this way, so the
 * colon is the author's own mark for where the name ends -- read, not guessed.
 * It is the same reading `parseOutline` already gives a table row, whose first
 * cell names the node and whose remaining cells become its prose.
 *
 * Only when the item is over budget. Splitting a label that already fits hides
 * half of it behind a click and buys nothing: 「接口：render(kernel)」 is one thing
 * to read, not a heading with a note. And only when a subject is actually there
 * -- with no colon, cutting at a character count would invent a heading the
 * document never had, so a long label is left long. Better long than wrong.
 */
export function splitLongItem(text: string): { title: string; note?: string } {
  if ([...text].length <= nameBudget) return { title: text }

  const mark = text.search(/[：:]/)
  if (mark <= 0) return { title: text }

  const subject = text.slice(0, mark).trim()
  const rest = text.slice(mark + 1).trim()
  // A URL's scheme is not a field name. `//` is what tells `https://x` apart
  // from 「见：x」, and nothing else puts it right after the colon.
  if (!subject || !rest || rest.startsWith("//")) return { title: text }
  if ([...subject].length > nameBudget || sentenceEnd.test(subject)) return { title: text }

  return { title: subject, note: rest }
}

function emptyNode(
  title: string,
  depth: number,
  kind: OutlineKind,
  line: number,
  ordered = false,
): OutlineNode {
  return { id: "", title, kind, depth, line, ordered, body: [], children: [] }
}

/**
 * Keep the whole line reachable on a node whose label will be clipped.
 *
 * The title always holds every word -- a rename writes it back to the document,
 * so shortening it there would delete the author's sentence. But the map draws
 * one line and cannot render 2280px of it, so for anything past the budget the
 * body is what makes the withheld tail readable: the 笔记 marker appears and the
 * full text is one click away.
 *
 * Only past the budget. Below it nothing is clipped, and a note repeating the
 * label would put a marker on every node in the document, marking nothing.
 */
function carryFullText(node: OutlineNode, text: string): void {
  if ([...text].length > nameBudget) node.body.push(text)
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

    // A fence is a hole in the syntax. Inside it "#" opens a Python comment,
    // "-" is a YAML sequence and "|" draws a table nobody wrote -- none of them
    // structure, all of them indistinguishable from it line by line. So the
    // block is taken whole, and taken raw: indentation is the syntax in Python
    // and a blank line is part of the sample, where the prose path trims both
    // because neither means anything in a sentence.
    //
    // The ``` lines are kept, unlike a table's alignment row, which is dropped
    // as punctuation. They are not punctuation here: the note panel draws prose
    // in a proportional font, so the fence is the only thing left telling the
    // reader that "x = 1" is code rather than a sentence.
    const fence = fencePattern.exec(line)
    if (fence) {
      const close = fenceClose(source, index + 1, fence[2])
      if (close !== -1) {
        const target = stack[stack.length - 1].node
        for (let cursor = index; cursor <= close; cursor += 1) target.body.push(source[cursor])
        index = close
        continue
      }
      // Never closed, so it was never a fence. Falling through reads the line
      // as the parser read it before fences existed, which leaves the sections
      // after it standing.
    }

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
      const section = emptyNode(title, depth, "heading", index)
      // A heading is the node whose words the reader needs most -- it names
      // everything indented under it -- and unlike a list item it is never split
      // on its colon, because a section's name is authored, not derived.
      carryFullText(section, title)
      appendAt(stack, section)
      headingDepth = depth
      continue
    }

    const item = listPattern.exec(line)
    if (item) {
      const indent = item[1].replace(/\t/g, " ".repeat(indentWidth)).length
      const itemDepth = headingDepth + 1 + Math.floor(indent / indentWidth)
      // A long item is a name and an explanation on one line. The explanation
      // goes in the body, where the note panel draws it, rather than into the
      // label -- 2449 items in the sample corpus run past 40 characters, and a
      // map carrying whole paragraphs is the document again in a worse shape.
      const source = item[3].trim()
      const { title, note } = splitLongItem(source)
      // `1.` and `1)` are both numbering; `-`, `*`, `+` are not.
      const node = emptyNode(title, itemDepth, "item", index, /^\d/.test(item[2]))
      // With a subject, the note is the explanation after it. Without one there
      // is nothing to split on, so the whole line is what gets carried.
      if (note) node.body.push(note)
      else carryFullText(node, source)
      appendAt(stack, node)
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
