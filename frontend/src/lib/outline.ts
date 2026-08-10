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
  /** Prose lines introduced under this node, in document order. */
  body: string[]
  children: OutlineNode[]
}

export interface ParseOutlineOptions {
  /** Used when the document has no leading level-1 heading of its own. */
  title?: string
}

const headingPattern = /^(#{1,6})\s+(.*)$/
const listPattern = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/
/** Two spaces per level is the CommonMark-ish convention; a tab counts as one. */
const indentWidth = 2

interface OpenNode {
  node: OutlineNode
  depth: number
}

function emptyNode(title: string, depth: number, kind: OutlineKind): OutlineNode {
  return { id: "", title, kind, depth, body: [], children: [] }
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
  const root = emptyNode(options.title ?? "", 0, "root")
  const stack: OpenNode[] = [{ node: root, depth: 0 }]
  // List depth is measured from the enclosing heading, not from the stack top,
  // so a nested list under a deep heading keeps its own relative shape.
  let headingDepth = 0

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd()
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
        headingDepth = depth
        continue
      }
      appendAt(stack, emptyNode(title, depth, "heading"))
      headingDepth = depth
      continue
    }

    const item = listPattern.exec(line)
    if (item) {
      const indent = item[1].replace(/\t/g, " ".repeat(indentWidth)).length
      const itemDepth = headingDepth + 1 + Math.floor(indent / indentWidth)
      appendAt(stack, emptyNode(item[2].trim(), itemDepth, "item"))
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
