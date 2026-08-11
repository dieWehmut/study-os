import { useMemo, useState } from "react"

import type { MindMap as MindMapData, MindNode } from "@/api/integrate"
import { plainInline } from "@/lib/markdown-inline"

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
/** The 重命名 marker on a node whose title can be written back to its source. */
const EDIT_W = 18
/**
 * The open title editor.
 *
 * Wider than the node it replaces, because a title being retyped is usually
 * being made longer, and a field that scrolls its own contents hides the half
 * you are not typing in.
 */
const EDIT_PANEL_W = 208
const EDIT_PANEL_H = 30
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
 * The open panel's drop below its node's bottom edge.
 *
 * A hairline, so the panel reads as hanging off the node above it rather than
 * as belonging to the row below. The layout reserves this plus the panel's own
 * height, which leaves the ordinary row gap between the panel and whatever
 * follows it.
 */
const NOTE_PANEL_GAP = 4
/**
 * How much of an opened panel a picture is given.
 *
 * A fixed box, with the picture fitted inside it: SVG cannot ask an image how
 * tall it wants to be, and the panel has to reserve its room before anything is
 * fetched. Letterboxing a wide diagram costs some white space; guessing the
 * aspect ratio instead would stretch it.
 */
const NOTE_IMAGE_H = 148

/**
 * Only pictures a browser will fetch as a picture.
 *
 * A map's markdown is written by a model or pasted in by hand, so the src is
 * untrusted input reaching an element that dereferences it. `data:` is the one
 * that matters -- a `data:image/svg+xml` document can carry script, and an
 * <image> pointing at one would run it. Anything whose scheme we do not
 * recognise is refused rather than guessed at; a bare or rooted path has no
 * scheme and stays, which is the form every wiki actually uses.
 */
function safeImageSrc(src?: string): string | undefined {
  const trimmed = src?.trim()
  if (!trimmed) return undefined
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (scheme && !/^https?$/i.test(scheme[1])) return undefined
  return trimmed
}

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
 *
 * The two markers are counted only when the node actually carries them, unlike
 * the caret: whether a node has a note, or a line to be renamed on, is fixed
 * for as long as the map is on screen, so reserving their width unconditionally
 * would pad every bare node for something that can never appear on it.
 */
function claimWidth(label: string, foldable: boolean, noted: boolean, editable: boolean): number {
  const extras = (foldable ? CARET_W + BADGE_W : 0) + (noted ? NOTE_W : 0) + (editable ? EDIT_W : 0)
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
function notePanelHeight(note: string, hasImage: boolean): number {
  const perLine = NOTE_PANEL_W - NOTE_PANEL_PAD * 2
  const lines = note
    ? note
        .split("\n")
        .reduce((total, line) => total + Math.max(1, Math.ceil(labelWidth(line) / perLine)), 0)
    : 0
  return lines * NOTE_LINE_H + (hasImage ? NOTE_IMAGE_H : 0) + NOTE_PANEL_PAD * 2
}

/**
 * What the node is offering to open.
 *
 * 0807:15 gives a node two things it may carry, and a marker that always says
 * 笔记 would announce a diagram as prose to anyone reading the map aloud.
 */
function carriedLabel(node: MindNode): string {
  return node.note ? "笔记" : "图片"
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
 * A node that has something opened under it, and how much room that needs.
 *
 * Threaded into the layout rather than drawn over it: the panel is drawn last
 * so that it covers the branch curves, which is right for a curve and wrong for
 * a label. Without a reservation the sibling one row down is simply hidden
 * underneath -- rare while every node was a heading, routine once a markdown
 * table turns each row into a tightly packed sibling carrying a note per column.
 *
 * Only the note needs this. The title editor also opens downward but is 30px
 * tall, so it already fits inside the gap between two rows.
 */
interface Spacer {
  id: string
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
function layout(nodes: MindNode[], widthOf: (id: string) => number, spacer?: Spacer): Layout {
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
  const rowTop = new Map<string, number>()
  // Rows are walked as pixels rather than counted as indices, because the room
  // an opened note needs is measured in pixels and does not divide into whole
  // rows. Counting rows and rounding up would pad the map by nearly a blank row
  // every time a two-line note was opened.
  let cursor = PAD
  let deepest = PAD

  // Post-order, because a parent's row is not known until its children have
  // one. Kept iterative: the nesting depth belongs to whatever document was
  // imported, and the call stack is not the place to find out how deep it went.
  for (const rootId of roots) {
    const stack = [{ id: rootId, level: 0, resolved: false }]
    while (stack.length > 0) {
      const frame = stack.pop()!
      const kids = children.get(frame.id) ?? []
      if (frame.resolved) {
        const first = rowTop.get(kids[0]!) ?? cursor
        rowTop.set(frame.id, (first + (rowTop.get(kids[kids.length - 1]!) ?? first)) / 2)
        // A parent carrying the note pushes what comes after it, exactly like a
        // leaf does. Safe to do here: its whole subtree is already placed, so
        // everything still to be placed really is below it.
        if (frame.id === spacer?.id) cursor += spacer.height
        continue
      }
      depth.set(frame.id, frame.level)
      if (kids.length === 0) {
        rowTop.set(frame.id, cursor)
        deepest = Math.max(deepest, cursor)
        // The panel's own footprint is inserted on top of the ordinary gap, so
        // the space that used to separate two rows now separates the panel from
        // the row below it.
        cursor += NODE_H + GAP_Y + (frame.id === spacer?.id ? spacer.height : 0)
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
      y: rowTop.get(node.id) ?? PAD,
    })
  }

  return {
    positions,
    depth,
    width: columnX[columns - 1]! + columnWidth[columns - 1]! + PAD,
    height: deepest + NODE_H + PAD,
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
 *
 * And a map you can retitle in place (0807:13 「可轻易编辑」). The map holds no
 * state of its own -- it is re-derived from markdown every time it is drawn --
 * so a rename cannot be kept here: `onRename` hands the new title back with the
 * source line it belongs on, and the caller writes it into the markdown the map
 * came from. Without that handler there is nowhere for an edit to land, so the
 * affordance is not offered at all.
 */
export function MindMap({
  data,
  fit = false,
  onRename,
}: {
  data: MindMapData
  fit?: boolean
  onRename?: (line: number, title: string) => void
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  // One at a time, not a set: two notes open side by side overlap each other
  // and the branches between them.
  const [openNote, setOpenNote] = useState<string | null>(null)
  // The draft lives here rather than in the node, because the node is rebuilt
  // from the markdown on every draw -- half-typed text kept there would be
  // thrown away by the first re-render.
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)

  /**
   * Whether this node's title has somewhere to be written back to.
   *
   * Both halves matter. A node with no `line` was never read out of a document
   * -- the root of a wiki entry's map is titled from the item's term -- and a
   * map arriving without `onRename` came over the wire with no local markdown
   * behind it. Either way a pencil would be a control that silently does
   * nothing, which is worse than no control at all.
   */
  const renamable = (node: MindNode) => Boolean(onRename) && node.line !== undefined

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
      map.set(
        node.id,
        claimWidth(
          // What the node will draw, not what the markdown wrote. An emphasised
          // label's asterisks are not on screen, so sizing by them pads the
          // column with room for characters that never appear.
          plainInline(node.label),
          children.has(node.id),
          Boolean(node.note || node.image),
          Boolean(onRename) && node.line !== undefined,
        ),
      )
    }
    return map
  }, [data.nodes, children, onRename])
  const widthOf = (id: string) => widths.get(id) ?? NODE_MIN_W

  // Folding a branch takes its open note with it, otherwise the panel is left
  // hanging beside a node that is no longer on screen.
  const notedId = openNote && visible.some((node) => node.id === openNote) ? openNote : null
  const noted = notedId ? byId.get(notedId) : undefined
  const notedSource = safeImageSrc(noted?.image)
  // Measured before the layout runs, so the rows below can be moved out of the
  // way. The height depends only on what the note says, never on where the node
  // ended up, so there is no circularity in asking for it first.
  const panelH =
    noted && (noted.note || notedSource)
      ? notePanelHeight(noted.note ?? "", Boolean(notedSource))
      : 0

  const { positions, depth, width, height } = layout(
    visible,
    widthOf,
    notedId && panelH ? { id: notedId, height: NOTE_PANEL_GAP + panelH } : undefined,
  )

  function toggle(id: string) {
    if (!children.has(id)) return
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  // The canvas has to cover the opened panel too.
  //
  // `layout` reserves the room *under* the node so nothing is covered, but it
  // knows nothing about how wide a panel is, and an SVG crops at its own edge:
  // a note hanging off a node in the last column had its right half — on a
  // picture, most of the picture — simply cut away. Taking the max here rather
  // than reserving the width inside `layout` means the map is not permanently
  // padded by 264px of white space for a panel that is usually shut.
  const notedAt = notedId ? positions.get(notedId) : undefined
  const canvasW = notedAt && panelH ? Math.max(width, notedAt.x + NOTE_PANEL_W + PAD) : width
  const canvasH =
    notedAt && panelH
      ? Math.max(height, notedAt.y + NODE_H + NOTE_PANEL_GAP + panelH + PAD)
      : height

  // Folding takes an open editor with it for the same reason it takes an open
  // note: a field hanging beside a node that is no longer drawn would write its
  // title back to a line the reader can no longer see.
  const editingAt = editing && visible.some((node) => node.id === editing.id)
    ? positions.get(editing.id)
    : undefined
  // The editor is wider than the node it sits on, so it can hang past the right
  // edge of a map exactly like a note panel does.
  const boardW = editingAt ? Math.max(canvasW, editingAt.x + EDIT_PANEL_W + PAD) : canvasW
  const boardH = editingAt
    ? Math.max(canvasH, editingAt.y + NODE_H + 4 + EDIT_PANEL_H + PAD)
    : canvasH


  function commitRename(node: MindNode, title: string) {
    // Guarded even though the pencil is only drawn when both hold: between the
    // click and the Enter the map may have been re-derived from markdown that
    // no longer has this line.
    if (onRename && node.line !== undefined) onRename(node.line, title)
    setEditing(null)
  }

  return (
    <div className={`${fit ? "overflow-hidden" : "overflow-auto"} rounded-xl border border-border bg-card p-2`}>
      {/*
        A map is measured in pixels from its own labels, so on a full-width card
        letting it overflow into a scroll keeps every label at full size. Hung
        off a wiki it gets a narrow column instead, and the same fixed width
        puts most of the tree past the right edge where scrolling a nested pane
        is the only way to reach it.

        `viewBox` is the seam: the drawing keeps the coordinate space `layout`
        computed, while the element takes whatever width the column offers, so
        no branch is ever unreachable. `data-width` exposes that intrinsic size
        for tests, which otherwise could not tell "scaled" from "clipped".
      */}
      <svg
        width={fit ? "100%" : boardW}
        height={fit ? undefined : boardH}
        viewBox={fit ? `0 0 ${boardW} ${boardH}` : undefined}
        data-width={boardW}
        data-height={boardH}
        role="tree"
        aria-label={`导图：${data.title}`}
      >
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
          // Computed once and used for the text, the underline and every
          // accessible name, so that what is drawn, what is measured and what is
          // read aloud cannot drift apart. `node.label` stays the source text --
          // the rename editor seeds from it, and writing these words back would
          // delete the author's emphasis from the document.
          const shown = plainInline(node.label)
          const ink = lineWidth(shown)
          const baseline = pos.y + BASELINE
          return (
            <g
              key={node.id}
              role="treeitem"
              // The label alone names the node; the caret and the count are
              // decoration and would otherwise be read out as part of it.
              aria-label={shown}
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
                {shown}
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
              {node.note || node.image ? (
                <g
                  role="button"
                  // Named for the node, because a map of forty nodes read aloud
                  // as forty identical "展开笔记" buttons names nothing.
                  aria-label={`${notedId === node.id ? "收起" : "展开"}${carriedLabel(node)}：${shown}`}
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
                    {/* Two glyphs, because the two things a node can carry are
                        not interchangeable: ≡ promises a sentence, ▣ promises a
                        picture, and the reader can tell before clicking. */}
                    {node.note ? "≡" : "▣"}
                  </text>
                </g>
              ) : null}
              {renamable(node) ? (
                <g
                  role="button"
                  // Named for the node, like the note marker: forty identical
                  // "重命名" buttons name nothing to anyone reading the map aloud.
                  aria-label={`重命名：${shown}`}
                  tabIndex={0}
                  style={{ cursor: "text" }}
                  onClick={(event) => {
                    // Same trap the note marker hit: this sits inside the node's
                    // own click target, so ungated, starting a rename folds the
                    // branch you were renaming in.
                    event.stopPropagation()
                    setEditing({ id: node.id, draft: node.label })
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    event.stopPropagation()
                    setEditing({ id: node.id, draft: node.label })
                  }}
                >
                  <rect
                    // Past the note marker when the node carries one, which is
                    // the width `claimWidth` reserved for exactly this pair.
                    x={pos.x + ink + (node.note || node.image ? NOTE_W : 0)}
                    y={pos.y + 6}
                    width={EDIT_W}
                    height={NODE_H - 12}
                    fill="transparent"
                    stroke="none"
                    aria-hidden="true"
                  />
                  <text
                    x={pos.x + ink + (node.note || node.image ? NOTE_W : 0) + 4}
                    y={baseline - 5}
                    fontSize={11}
                    fill={tone.stroke}
                    opacity={0.55}
                    aria-hidden="true"
                  >
                    ✎
                  </text>
                </g>
              ) : null}
            </g>
          )
        })}
        {/* Last, so it draws over the branches rather than under them -- a note
            you can read through is not a note. */}
        {(() => {
          // Reuses what the canvas was sized against, rather than measuring the
          // panel a second time: two copies of this arithmetic that disagree is
          // exactly the clipping bug the canvas sizing above exists to prevent.
          if (!noted || !notedAt || !panelH) return null
          const node = noted
          const pos = notedAt
          const source = notedSource
          const lines = node.note ? node.note.split("\n") : []
          const top = pos.y + NODE_H + NOTE_PANEL_GAP
          return (
            <g role="note" aria-label={`${carriedLabel(node)}：${plainInline(node.label)}`}>
              <rect
                x={pos.x}
                y={top}
                width={NOTE_PANEL_W}
                height={panelH}
                rx={8}
                fill="#ffffff"
                stroke={nodeTone(node.node_type).stroke}
                strokeWidth={1}
                opacity={0.98}
              />
              {source ? (
                // Above the prose, because the picture is what the sentence
                // under it is describing. `meet` rather than `slice`: a diagram
                // cropped to fill the box loses the axis labels that made it a
                // diagram.
                <image
                  x={pos.x + NOTE_PANEL_PAD}
                  y={top + NOTE_PANEL_PAD}
                  width={NOTE_PANEL_W - NOTE_PANEL_PAD * 2}
                  height={NOTE_IMAGE_H}
                  href={source}
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  // Falls back to the node's own label: an <image> with no
                  // accessible name is announced as an unnamed graphic, and the
                  // heading it hangs under is the best description available.
                  aria-label={node.image_alt || plainInline(node.label)}
                />
              ) : null}
              <foreignObject
                x={pos.x + NOTE_PANEL_PAD}
                y={top + NOTE_PANEL_PAD + (source ? NOTE_IMAGE_H : 0)}
                width={NOTE_PANEL_W - NOTE_PANEL_PAD * 2}
                height={panelH - NOTE_PANEL_PAD * 2 - (source ? NOTE_IMAGE_H : 0)}
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
        {/* After the note panel, because an editor a note draws over is an
            editor you cannot see what you are typing into. */}
        {(() => {
          if (!editing || !editingAt) return null
          const node = byId.get(editing.id)
          if (!node) return null
          const top = editingAt.y + NODE_H + 4
          return (
            <foreignObject
              x={editingAt.x}
              y={top}
              width={EDIT_PANEL_W}
              height={EDIT_PANEL_H}
            >
              {/* foreignObject for the same reason the note uses one: SVG has no
                  text input of its own, and reimplementing caret handling on
                  <text> to avoid one input element is not a trade worth making. */}
              <input
                aria-label="节点标题"
                value={editing.draft}
                // Focused on mount so the pencil click lands in the field. A
                // ref-and-effect would do the same thing one frame later, which
                // is one frame in which a keystroke goes to the tree instead.
                autoFocus
                onChange={(event) => setEditing({ id: editing.id, draft: event.target.value })}
                onKeyDown={(event) => {
                  // Stopped in every branch: the tree behind this listens for
                  // Enter and Space to fold, and typing a space into a title
                  // would otherwise collapse the branch being renamed.
                  event.stopPropagation()
                  if (event.key === "Enter") {
                    event.preventDefault()
                    commitRename(node, editing.draft)
                    return
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    // Discarded, not committed. Escape is what someone presses
                    // on realising they are editing the wrong node, and the
                    // rename it would otherwise save has no undo.
                    setEditing(null)
                  }
                }}
                // Abandoned on blur rather than saved: clicking away is how you
                // leave an edit you did not mean to start, and a map that
                // rewrites the wiki whenever focus moves is not one you can
                // click around in.
                onBlur={() => setEditing(null)}
                style={{
                  width: "100%",
                  height: EDIT_PANEL_H - 4,
                  boxSizing: "border-box",
                  font: `${FONT_SIZE}px/1.4 inherit`,
                  color: "#27272a",
                  padding: "0 8px",
                  borderRadius: 6,
                  border: `1px solid ${nodeTone(node.node_type).stroke}`,
                  background: "#ffffff",
                  outline: "none",
                }}
              />
            </foreignObject>
          )
        })()}
      </svg>
    </div>
  )
}
