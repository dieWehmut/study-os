import { headingPattern, listPattern } from "./outline"

/**
 * Editing a mindmap, by editing the markdown it was drawn from.
 *
 * The map is re-derived on every draw and never stored (0807:75), so it has no
 * state of its own to change: a rename has to land in the source, or it does
 * not survive the next parse.
 */

/**
 * Rewrite the title on one source line, leaving the document otherwise byte-equal.
 *
 * One line, rather than regenerating the markdown from the tree. The outline
 * parser models headings, list items and prose; it does not model blank lines,
 * code fences, tables or trailing whitespace, so a regenerated document would
 * launder everything it does not understand. Addressing the line the node came
 * from keeps a rename a rename.
 *
 * Returns null rather than throwing or returning the input unchanged: the two
 * outcomes have to be distinguishable, because the caller shows one of them to
 * the reader as "saved" and the other as a refusal.
 */
export function renameOutlineLine(markdown: string, line: number, title: string): string | null {
  const lines = markdown.split("\n")
  if (line < 0 || line >= lines.length) return null

  const trimmed = title.trim()
  // An empty heading is not a heading -- the node and everything nested under
  // it would drop out of the map. A newline splits one node into two, and a
  // leading `#` re-levels every section after it. None of those is an edit
  // someone typing a name asked for.
  if (!trimmed || /[\r\n]/.test(trimmed) || headingPattern.test(trimmed)) return null

  const source = lines[line]

  const heading = headingPattern.exec(source)
  if (heading) {
    lines[line] = `${heading[1]} ${trimmed}`
    return lines.join("\n")
  }

  const item = listPattern.exec(source)
  if (item) {
    // Indentation and marker are put back verbatim: indentation is what the
    // parser reads depth from, so losing it reparents the node being renamed,
    // and an ordered list rewritten as `-` renumbers nothing but loses its
    // ordering.
    lines[line] = `${item[1]}${item[2]} ${trimmed}`
    return lines.join("\n")
  }

  // Prose carries no title. Rewriting it would replace a whole sentence with a
  // node label -- the map's own root, when it was titled from the item's term
  // rather than from the document, reports line -1 for exactly this reason.
  return null
}
