import type { MindMap, MindNode } from "@/api/integrate"
import { flattenOutline, parseOutline, type OutlineNode, type ParseOutlineOptions } from "./outline"

/** Used when the source is a fragment with no level-1 heading of its own. */
const fallbackTitle = "未命名"

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
    const note = node.body.join("\n")
    nodes.push({
      id: node.id,
      label: node === root ? title : node.title,
      parent_id: parentId,
      node_type: node.kind,
      // Omitted, not empty: "has a note" is what decides whether the drawing
      // marks a node as openable, and "" would mark every node in the map.
      ...(note ? { note } : {}),
    })
    for (const child of node.children) parents.set(child, node.id)
  }

  // A document with no sections has no skeleton to show; a lone root box would
  // claim otherwise.
  if (root.children.length === 0) return { title, nodes: [] }
  return { title, nodes }
}
