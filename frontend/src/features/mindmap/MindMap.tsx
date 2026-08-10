import { useMemo, useState } from "react"

import type { MindMap as MindMapData, MindNode } from "@/api/integrate"

const NODE_MIN_W = 56
const NODE_H = 40
const GAP_X = 36
const GAP_Y = 52
const PAD = 24
const FONT_SIZE = 13
/** How far the underline runs past the end of the label. */
const TEXT_PAD = 10
/** The ▸/▾ caret, sitting at the far end where the branch leaves. */
const CARET_W = 14
/** The "+12" on a folded node. Reserved on anything foldable so that folding
 *  changes the rows and nothing else -- a node that also resized under the
 *  cursor would make the click feel like it hit something. */
const BADGE_W = 34
/** The 笔记 marker on a node that has prose written under it. */
const NOTE_W = 18
/** Where the underline sits in a node's row, measured from the row's top. */
const BASELINE = NODE_H / 2 + 8
/**
 * The opened note.
 *
 * Wide enough for a sentence to be a sentence rather than a column of two-word
 * lines, and no wider -- a note as wide as the map would cover the branches it
 * is supposed to explain.
 */
const NOTE_PANEL_W = 264
const NOTE_LINE_H = 20
const NOTE_PANEL_PAD = 10

/**
 * Roughly how wide this label draws.
 *
 * Canvas measurement would be exact, but it is unavailable under jsdom and the
 * layout has to be the same in a test as on screen. Two buckets are enough:
 * CJK sits on a full em, Latin and digits on a bit over half of one.
 */
function labelWidth(label: string): number {
  let total = 0
  for (const character of label) {
    total += /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(character) ? FONT_SIZE : FONT_SIZE * 0.58
  }
  return total
}

/**
 * How much room the node claims in its column.
 *
 * Includes space for the caret and the folded count even while neither is on
 * screen, so that folding a node moves rows and nothing else. A node whose
 * column also widened under the cursor would make the click feel like it hit
 * something.
 */
function claimWidth(label: string, foldable: boolean, noted: boolean): number {
  const extras = (foldable ? CARET_W + BADGE_W : 0) + (noted ? NOTE_W : 0)
  return Math.max(NODE_MIN_W, Math.ceil(lineWidth(label) + extras))
}

/**
 * How long the underline is actually drawn -- the label, and no more.
 *
 * Deliberately not `claimWidth`. Drawing the reserved caret and badge space as
 * line would leave every foldable node with a 48px blank tail in its own
 * colour, running out past the label and into the connector; parent line,
 * connector and child line then read as one continuous stroke and you cannot
 * see where one node ends. The reservation belongs to the layout, not the ink.
 */
function lineWidth(label: string): number {
  return Math.ceil(labelWidth(label) + TEXT_PAD)
}

/**
 * How tall an opened note draws.
 *
 * Estimated from the same two-bucket character width the labels use, for the
 * same reason: the panel has to reserve its space before the browser has laid
 * any text out, and it has to reserve the same space under jsdom.
 */
function notePanelHeight(note: string): number {
  const perLine = NOTE_PANEL_W - NOTE_PANEL_PAD * 2
  const lines = note
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(labelWidth(line) / perLine)), 0)
  return lines * NOTE_LINE_H + NOTE_PANEL_PAD * 2
}

/**
 * How a node is drawn -- as a line under its label, not as a box around it.
 *
 * 「节点样式别是一个一个像 obsidian canvas 那样的一个一个方框就行」(0807:16). A box
 * per node is a container you have to read past before reaching the label, and
 * with forty of them the map becomes the grid it was meant to replace. The
 * label alone is the node; the line under it is only there to carry the branch
 * on to its children.
 *
 * Weight, not colour, is what separates a section from a point. 0807:16 also
 * says colour does not matter, and a hierarchy carried by hue alone is no
 * hierarchy to anyone who cannot see the difference. Colour stays as a second,
 * redundant channel -- never as the only one.
 */
function nodeTone(nodeType?: string): { stroke: string; text: string; weight: number } {
  switch (nodeType) {
    case "root":
      return { stroke: "#16a34a", text: "#14532d", weight: 2.6 }
    // A section is a place you can stand; a point inside one is not. Drawn the
    // same, a chapter and a single bullet read as peers.
    case "heading":
      return { stroke: "#2563eb", text: "#1e3a8a", weight: 1.8 }
    case "conclusion":
      return { stroke: "#b45309", text: "#7c2d12", weight: 1.8 }
    case "trap":
      return { stroke: "#dc2626", text: "#7f1d1d", weight: 1.8 }
    default:
      return { stroke: "#a1a1aa", text: "#27272a", weight: 1 }
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
 *
 * Columns are laid out cumulatively from the widest node in each one, because
 * nodes size to their own label. A fixed stride would let one long heading run
 * straight through the column holding its children.
 */
function layout(nodes: MindNode[], widthOf: (id: string) => number): Layout {
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

  const columns = Math.max(0, ...depth.values()) + 1
  const columnWidth: number[] = Array.from({ length: columns }, () => NODE_MIN_W)
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0
    columnWidth[column] = Math.max(columnWidth[column]!, widthOf(node.id))
  }
  const columnX: number[] = []
  for (let column = 0; column < columns; column += 1) {
    columnX[column] =
      column === 0 ? PAD : columnX[column - 1]! + columnWidth[column - 1]! + GAP_X
  }

  const positions = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    positions.set(node.id, {
      x: columnX[depth.get(node.id) ?? 0]!,
      y: PAD + (row.get(node.id) ?? 0) * (NODE_H + GAP_Y),
    })
  }

  return {
    positions,
    depth,
    width: columnX[columns - 1]! + columnWidth[columns - 1]! + PAD,
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
 *
 * Notes fold the same way and for the same reason. A node's label is a heading
 * lifted out of the wiki; the prose it was lifted from is what tells you
 * whether you still understand it (0807:15). Open on demand, one at a time --
 * every note open at once is the wall of prose again.
 */
export function MindMap({ data }: { data: MindMapData }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  // One at a time, not a set: two notes open side by side overlap each other
  // and the branches between them.
  const [openNote, setOpenNote] = useState<string | null>(null)

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

  // Sized from the full tree, not from what is on screen, so that folding a
  // branch moves rows without also resizing the node under the cursor.
  const widths = useMemo(() => {
    const map = new Map<string, number>()
    for (const node of data.nodes) {
      map.set(node.id, claimWidth(node.label, children.has(node.id), Boolean(node.note)))
    }
    return map
  }, [data.nodes, children])
  const widthOf = (id: string) => widths.get(id) ?? NODE_MIN_W

  const { positions, depth, width, height } = layout(visible, widthOf)

  function toggle(id: string) {
    if (!children.has(id)) return
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  // Folding a branch takes its open note with it, otherwise the panel is left
  // hanging beside a node that is no longer on screen.
  const notedId = openNote && visible.some((node) => node.id === openNote) ? openNote : null

  return (
    <div className="overflow-auto rounded-xl border border-border bg-card p-2">
      <svg width={width} height={height} role="tree" aria-label={`导图：${data.title}`}>
        {visible.map((node) => {
          if (!node.parent_id || !byId.has(node.parent_id)) return null
          const child = positions.get(node.id)
          const parent = positions.get(node.parent_id)
          if (!child || !parent) return null
          // Underline to underline, not centre to centre: the branch is the same
          // stroke as the line the label sits on, so it reads as one continuous
          // trunk rather than a wire between two objects. Which means it has to
          // start where the ink stops, not at the column edge -- the reserved
          // caret space between the two would otherwise show as a break.
          const x1 = parent.x + lineWidth(byId.get(node.parent_id)!.label)
          const y1 = parent.y + BASELINE
          const x2 = child.x
          const y2 = child.y + BASELINE
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
          const span = widthOf(node.id)
          // The line stops at the label. The claim runs further, and the caret
          // and count live in that difference -- past the ink, before the
          // branch leaves.
          const ink = lineWidth(node.label)
          const baseline = pos.y + BASELINE
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
              {/* Invisible, and the only thing here with any area: without it
                  the click target is the glyphs themselves, and the gaps
                  between characters stop being part of the node. */}
              <rect
                x={pos.x}
                y={pos.y}
                width={span}
                height={NODE_H}
                fill="transparent"
                stroke="none"
                aria-hidden="true"
              />
              <text
                x={pos.x}
                y={baseline - 5}
                fontSize={FONT_SIZE}
                fill={tone.text}
                fontWeight={node.node_type === "root" ? 600 : undefined}
              >
                {node.label}
              </text>
              <line
                x1={pos.x}
                y1={baseline}
                x2={pos.x + ink}
                y2={baseline}
                stroke={tone.stroke}
                strokeWidth={tone.weight}
                strokeLinecap="round"
              />
              {foldable ? (
                <text
                  x={pos.x + span - (hidden > 0 ? BADGE_W : 0) - 4}
                  y={baseline - 5}
                  textAnchor="end"
                  fontSize={10}
                  fill={tone.text}
                  opacity={0.65}
                >
                  {folded ? "▸" : "▾"}
                </text>
              ) : null}
              {hidden > 0 ? (
                <text
                  x={pos.x + span}
                  y={baseline - 5}
                  textAnchor="end"
                  fontSize={11}
                  fill={tone.text}
                  opacity={0.75}
                >
                  {`+${hidden}`}
                </text>
              ) : null}
              {node.note ? (
                <g
                  role="button"
                  // Named for the node, because a map of forty nodes read aloud
                  // as forty identical "展开笔记" buttons names nothing.
                  aria-label={`${notedId === node.id ? "收起" : "展开"}笔记：${node.label}`}
                  aria-expanded={notedId === node.id}
                  tabIndex={0}
                  style={{ cursor: "pointer" }}
                  onClick={(event) => {
                    // The marker sits inside the node's own click target, which
                    // toggles the fold. Ungated, reading a note collapses the
                    // branch you were reading it in.
                    event.stopPropagation()
                    setOpenNote((previous) => (previous === node.id ? null : node.id))
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    event.stopPropagation()
                    setOpenNote((previous) => (previous === node.id ? null : node.id))
                  }}
                >
                  <rect
                    x={pos.x + ink}
                    y={pos.y + 6}
                    width={NOTE_W}
                    height={NODE_H - 12}
                    fill="transparent"
                    stroke="none"
                    aria-hidden="true"
                  />
                  <text
                    x={pos.x + ink + 4}
                    y={baseline - 5}
                    fontSize={11}
                    fill={tone.stroke}
                    opacity={0.8}
                    aria-hidden="true"
                  >
                    ≡
                  </text>
                </g>
              ) : null}
            </g>
          )
        })}
        {/* Last, so it draws over the branches rather than under them -- a note
            you can read through is not a note. */}
        {(() => {
          if (!notedId) return null
          const node = byId.get(notedId)
          const pos = positions.get(notedId)
          if (!node?.note || !pos) return null
          const lines = node.note.split("\n")
          const panelH = notePanelHeight(node.note)
          return (
            <g role="note" aria-label={`笔记：${node.label}`}>
              <rect
                x={pos.x}
                y={pos.y + NODE_H + 4}
                width={NOTE_PANEL_W}
                height={panelH}
                rx={8}
                fill="#ffffff"
                stroke={nodeTone(node.node_type).stroke}
                strokeWidth={1}
                opacity={0.98}
              />
              <foreignObject
                x={pos.x + NOTE_PANEL_PAD}
                y={pos.y + NODE_H + 4 + NOTE_PANEL_PAD}
                width={NOTE_PANEL_W - NOTE_PANEL_PAD * 2}
                height={panelH - NOTE_PANEL_PAD * 2}
              >
                {/* foreignObject rather than <text>: SVG text does not wrap, and
                    a note is prose. The estimate above only has to reserve the
                    room; the browser does the actual wrapping. */}
                <div
                  style={{
                    font: "12px/20px inherit",
                    color: "#3f3f46",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {lines.join("\n")}
                </div>
              </foreignObject>
            </g>
          )
        })()}
      </svg>
    </div>
  )
}
