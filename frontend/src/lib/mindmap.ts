import type { MindMap, MindNode } from "@/api/integrate"
import { flattenOutline, parseOutline, type OutlineNode, type ParseOutlineOptions } from "./outline"

/** Used when the source is a fragment with no level-1 heading of its own. */
const fallbackTitle = "未命名"

/**
 * A line that is nothing but a picture: `![alt](src)`, optionally titled.
 *
 * Anchored to the whole line on purpose. An image mentioned mid-sentence is
 * part of that sentence; pulling it out would leave a hole in the prose where
 * the author deliberately put it.
 */
const imagePattern = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)$/

/**
 * Separate the picture a section carries from the prose it says.
 *
 * 0807:15 「每个节点可以是笔记、图片」. The map is re-derived from markdown every
 * time it is drawn and is never stored, so a node has nowhere of its own to
 * keep a picture: whatever `![](...)` the wiki already carries has to be it.
 * That also means the picture survives a re-parse exactly like the shape does.
 *
 * Left alone, an image line is just another body line and reaches the reader as
 * the literal text "![示意图](/img/light.png)" -- the right node, the wrong form.
 *
 * Only the first picture is lifted. A node is a label with one thing pinned
 * under it; a second stays in the prose rather than being dropped, which is
 * where every one of them sits today anyway.
 */
function liftImage(body: string[]): { image?: string; image_alt?: string; note: string } {
  const prose: string[] = []
  let source = ""
  let alt = ""
  for (const line of body) {
    const match = source ? null : imagePattern.exec(line)
    if (match) {
      source = match[2]
      alt = match[1]
      continue
    }
    prose.push(line)
  }
  return {
    ...(source ? { image: source } : {}),
    // An empty alt is a decorative image saying so. Carrying "" would hand a
    // screen reader an empty description instead of no description.
    ...(alt ? { image_alt: alt } : {}),
    note: prose.join("\n"),
  }
}

/**
 * Deterministic markdown -> mindmap.
 *
 * A model may write the prose that goes into a wiki; it must not arrange the
 * map. A tree that comes back rearranged on the second run is not something
 * you can study before reading -- you would have to learn the shape again each
 * time, which is exactly the cost the map exists to remove. Heading levels and
 * list indentation already say everything the layout needs, so nothing here
 * has to be guessed.
 *
 * Prose does not become nodes -- a map carrying whole paragraphs is just the
 * document again in a worse shape. It rides along on the node it was written
 * under instead (0807:15), so the skeleton stays readable and the sentence it
 * was abstracted from is still one click away.
 */
export function markdownToMindMap(markdown: string, options: ParseOutlineOptions = {}): MindMap {
  const root = parseOutline(markdown, options)
  const title = root.title || options.title || fallbackTitle

  // Ids come from the outline, where they are derived from a node's position.
  // Deriving them from titles instead would merge two sections that happen to
  // share a name -- "例题" appears a dozen times in one chapter.
  const nodes: MindNode[] = []
  const parents = new Map<OutlineNode, string>()

  for (const node of flattenOutline(root)) {
    const parentId = parents.get(node)
    const { note, ...picture } = liftImage(node.body)
    nodes.push({
      id: node.id,
      label: node === root ? title : node.title,
      parent_id: parentId,
      node_type: node.kind,
      ...picture,
      // Omitted, not empty: "has a note" is what decides whether the drawing
      // marks a node as openable, and "" would mark every node in the map.
      // Which is also why the picture had to come out first -- a node whose
      // only body line was an image would otherwise offer a blank panel.
      ...(note ? { note } : {}),
    })
    for (const child of node.children) parents.set(child, node.id)
  }

  // A document with no sections has no skeleton to show; a lone root box would
  // claim otherwise.
  if (root.children.length === 0) return { title, nodes: [] }
  return { title, nodes }
}
