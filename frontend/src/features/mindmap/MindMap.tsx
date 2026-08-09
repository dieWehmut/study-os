import { useMemo, useState } from "react"

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
    // A section is a place you can stand; a point inside one is not. Drawn the
    // same, a chapter and a single bullet read as peers.
    case "heading":
      return { fill: "#2563eb18", stroke: "#2563eb66", text: "#1e40af" }
    case "conclusion":
      return { fill: "#b4530918", stroke: "#b4530966", text: "#92400e" }
    case "trap":
      return { fill: "#dc262618", stroke: "#dc262666", text: "#991b1b" }
    default:
      return { fill: "#f4f4f5", stroke: "#d4d4d8", text: "#18181b" }
  }
}

interface Layout {
  positions: Map<string, { x: number; y: number }>
  depth: Map<string, number>
  width: number
  height: number
}

/**
 * Right-facing tree: depth picks the column, the subtree picks the row.
 *
 * Rows go to leaves in reading order and every parent takes the midpoint of its
 * own first and last child, so a branch stays level with the node it hangs off.
 * Spreading a level's nodes by their index across the whole width instead lets
 * a child drift far from its parent, and the long diagonal edge that follows
 * reads as a link between unrelated branches.
 */
function layout(nodes: MindNode[]): Layout {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const node of nodes) {
    if (!node.parent_id || !byId.has(node.parent_id)) {
      roots.push(node.id)
      continue
    }
    children.set(node.parent_id, [...(children.get(node.parent_id) ?? []), node.id])
  }

  const depth = new Map<string, number>()
  const row = new Map<string, number>()
  let rows = 0

  // Post-order, because a parent's row is not known until its children have
  // one. Kept iterative: the nesting depth belongs to whatever document was
  // imported, and the call stack is not the place to find out how deep it went.
  for (const rootId of roots) {
    const stack = [{ id: rootId, level: 0, resolved: false }]
    while (stack.length > 0) {
      const frame = stack.pop()!
      const kids = children.get(frame.id) ?? []
      if (frame.resolved) {
        const first = row.get(kids[0]!) ?? 0
        row.set(frame.id, (first + (row.get(kids[kids.length - 1]!) ?? first)) / 2)
        continue
      }
      depth.set(frame.id, frame.level)
      if (kids.length === 0) {
        row.set(frame.id, rows++)
        continue
      }
      stack.push({ ...frame, resolved: true })
      // Reversed, so the first child is popped first and keeps the lowest row.
      for (const kid of [...kids].reverse()) {
        stack.push({ id: kid, level: frame.level + 1, resolved: false })
      }
    }
  }

  const positions = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    positions.set(node.id, {
      x: PAD + (depth.get(node.id) ?? 0) * (NODE_W + GAP_X),
      y: PAD + (row.get(node.id) ?? 0) * (NODE_H + GAP_Y),
    })
  }

  const columns = Math.max(0, ...depth.values()) + 1
  return {
    positions,
    depth,
    width: PAD * 2 + columns * (NODE_W + GAP_X) - GAP_X,
    height: PAD * 2 + Math.max(1, rows) * (NODE_H + GAP_Y) - GAP_Y,
  }
}

/** Every node beneath this one, however deep. */
function countDescendants(id: string, children: Map<string, string[]>): number {
  return (children.get(id) ?? []).reduce(
    (total, child) => total + 1 + countDescendants(child, children),
    0,
  )
}

/**
 * A mindmap you can fold.
 *
 * The whole map at once is the same wall of information the map was supposed
 * to replace. Folding a branch you are not working on is the thing paper
 * cannot do: the shape stays, the detail goes, and the count on the folded
 * node says exactly how much is waiting there so nothing disappears quietly.
 */
export function MindMap({ data }: { data: MindMapData }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  const byId = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes])
  const children = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const node of data.nodes) {
      if (!node.parent_id || !byId.has(node.parent_id)) continue
      map.set(node.parent_id, [...(map.get(node.parent_id) ?? []), node.id])
    }
    return map
  }, [data.nodes, byId])

  // Folding hides the whole subtree, not just the row below: orphaned
  // grandchildren would read as a second map rather than a fold.
  const visible = data.nodes.filter((node) => {
    let current = node
    while (current.parent_id) {
      const parent = byId.get(current.parent_id)
      if (!parent) break
      if (collapsed.has(parent.id)) return false
      current = parent
    }
    return true
  })

  const { positions, depth, width, height } = layout(visible)

  function toggle(id: string) {
    if (!children.has(id)) return
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  return (
    <div className="overflow-auto rounded-xl border border-border bg-card p-2">
      <svg width={width} height={height} role="tree" aria-label={`导图：${data.title}`}>
        {visible.map((node) => {
          if (!node.parent_id || !byId.has(node.parent_id)) return null
          const child = positions.get(node.id)
          const parent = positions.get(node.parent_id)
          if (!child || !parent) return null
          const x1 = parent.x + NODE_W
          const y1 = parent.y + NODE_H / 2
          const x2 = child.x
          const y2 = child.y + NODE_H / 2
          const mid = (x1 + x2) / 2
          return (
            <path
              key={`edge-${node.id}`}
              d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="#a1a1aa"
              strokeWidth={1.2}
            />
          )
        })}
        {visible.map((node) => {
          const pos = positions.get(node.id)
          if (!pos) return null
          const tone = nodeTone(node.node_type)
          const foldable = children.has(node.id)
          const folded = collapsed.has(node.id)
          const hidden = folded ? countDescendants(node.id, children) : 0
          const label = node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label
          return (
            <g
              key={node.id}
              role="treeitem"
              // The label alone names the node; the caret and the count are
              // decoration and would otherwise be read out as part of it.
              aria-label={node.label}
              aria-level={(depth.get(node.id) ?? 0) + 1}
              aria-expanded={foldable ? !folded : undefined}
              tabIndex={0}
              onClick={() => toggle(node.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                toggle(node.id)
              }}
              style={{ cursor: foldable ? "pointer" : "default" }}
            >
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill={tone.fill}
                stroke={tone.stroke}
              />
              {foldable ? (
                <text
                  x={pos.x + 12}
                  y={pos.y + NODE_H / 2 + 4}
                  fontSize={10}
                  fill={tone.text}
                  opacity={0.65}
                >
                  {folded ? "▸" : "▾"}
                </text>
              ) : null}
              <text
                x={pos.x + NODE_W / 2}
                y={pos.y + NODE_H / 2 + 4}
                textAnchor="middle"
                fontSize={13}
                fill={tone.text}
              >
                {label}
              </text>
              {hidden > 0 ? (
                <text
                  x={pos.x + NODE_W - 10}
                  y={pos.y + NODE_H / 2 + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill={tone.text}
                  opacity={0.75}
                >
                  {`+${hidden}`}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
