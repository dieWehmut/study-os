import type { MindMap as MindMapData } from "@/api/integrate"

export function toMermaid(data: MindMapData): string {
  const escape = (value: string) => value.replace(/"/g, "&quot;")
  const idMap = new Map<string, string>()
  data.nodes.forEach((node, index) => idMap.set(node.id, `n${index}`))
  const lines = ["graph TD"]
  data.nodes.forEach((node, index) => {
    lines.push(`  ${idMap.get(node.id) ?? `n${index}`}["${escape(node.label)}"]`)
  })
  data.nodes.forEach((node, index) => {
    if (!node.parent_id) return
    const id = idMap.get(node.id) ?? `n${index}`
    const parentId = idMap.get(node.parent_id)
    if (parentId) lines.push(`  ${parentId} --> ${id}`)
  })
  return lines.join("\n")
}
