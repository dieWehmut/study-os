import type { MindMap as MindMapData, MindNode } from "@/api/integrate"

const NODE_W = 180
const NODE_H = 40
const GAP_X = 36
const GAP_Y = 52
const PAD = 24

function nodeTone(nodeType?: string): { fill: string; stroke: string; text: string } {
  switch (nodeType) {
    case "root":
      return { fill: "#16a34a18", stroke: "#16a34a66", text: "#166534" }
    case "conclusion":
      return { fill: "#b4530918", stroke: "#b4530966", text: "#92400e" }
    case "trap":
      return { fill: "#dc262618", stroke: "#dc262666", text: "#991b1b" }
    default:
      return { fill: "#f4f4f5", stroke: "#d4d4d8", text: "#18181b" }
  }
}

function depthOf(node: MindNode, byId: Map<string, MindNode>): number {
  let depth = 0
  let current = node
  while (current.parent_id && byId.has(current.parent_id)) {
    current = byId.get(current.parent_id)!
    depth++
  }
  return depth
}

function layout(nodes: MindNode[]): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string, string[]>()
  let rootId = nodes[0]?.id ?? ""
  for (const node of nodes) {
    if (!node.parent_id || !byId.has(node.parent_id)) {
      rootId = node.id
      continue
    }
    const list = children.get(node.parent_id) ?? []
    list.push(node.id)
    children.set(node.parent_id, list)
  }
  const depth = new Map(nodes.map((node) => [node.id, depthOf(node, byId)]))
  const levelCounts: number[] = []
  nodes.forEach((node) => {
    const level = depth.get(node.id) ?? 0
    levelCounts[level] = (levelCounts[level] ?? 0) + 1
  })
  const maxLevel = Math.max(0, ...Array.from(depth.values()))
  const maxCount = Math.max(1, ...levelCounts.filter((count) => count > 0))
  const width = maxCount * (NODE_W + GAP_X) + PAD * 2 - GAP_X
  const height = (maxLevel + 1) * (NODE_H + GAP_Y) + PAD * 2

  const order = new Map<string, number>()
  const queue: Array<{ id: string; level: number }> = [{ id: rootId, level: 0 }]
  const levelOrder = new Map<number, number>()
  while (queue.length > 0) {
    const { id, level } = queue.shift()!
    order.set(id, levelOrder.get(level) ?? 0)
    levelOrder.set(level, (levelOrder.get(level) ?? 0) + 1)
    for (const child of children.get(id) ?? []) {
      queue.push({ id: child, level: level + 1 })
    }
  }
  const positions = new Map<string, { x: number; y: number }>()
  nodes.forEach((node) => {
    const level = depth.get(node.id) ?? 0
    const index = order.get(node.id) ?? 0
    const count = levelCounts[level] ?? 1
    positions.set(node.id, {
      x: PAD + (index - (count - 1) / 2) * (NODE_W + GAP_X),
      y: PAD + level * (NODE_H + GAP_Y),
    })
  })
  return { positions, width, height }
}

export function MindMap({ data }: { data: MindMapData }) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]))
  const { positions, width, height } = layout(data.nodes)
  return (
    <div className="overflow-auto rounded-xl border border-border bg-card p-2">
      <svg width={width} height={height} role="img" aria-label={`导图：${data.title}`}>
        {data.nodes.map((node) => {
          if (!node.parent_id || !byId.has(node.parent_id)) return null
          const child = positions.get(node.id)
          const parent = positions.get(node.parent_id)
          if (!child || !parent) return null
          const x1 = parent.x + NODE_W / 2
          const y1 = parent.y + NODE_H
          const x2 = child.x + NODE_W / 2
          const y2 = child.y
          const mid = (y1 + y2) / 2
          return <path key={`edge-${node.id}`} d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`} fill="none" stroke="#a1a1aa" strokeWidth={1.2} />
        })}
        {data.nodes.map((node) => {
          const pos = positions.get(node.id)
          if (!pos) return null
          const tone = nodeTone(node.node_type)
          return (
            <g key={node.id}>
              <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={10} fill={tone.fill} stroke={tone.stroke} />
              <text x={pos.x + NODE_W / 2} y={pos.y + NODE_H / 2 + 4} textAnchor="middle" fontSize={13} fill={tone.text}>
                {node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
