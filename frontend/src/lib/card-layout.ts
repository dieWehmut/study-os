/**
 * Blocks -> coordinates.
 *
 * The canvas is computed, not declared. `SKILL.md` fixes it at 1133 × 1511 and
 * silently truncates what does not fit, which is why its output slides into
 * 方框长条 the moment there is a little too much to say (0807:41). There is no
 * constant here and no clipping path: `h` is the sum of what the content
 * needed, so "do not lock the dimensions" is a line of arithmetic rather than a
 * request for a model to behave.
 *
 * Two geometries cover four structures, which is the derivation law of
 * `structures.md` §1.1 showing up in the code: closure is the switch that bends
 * a strip into a ring, and a centre is the switch that puts something in the
 * middle of one.
 */

import type { Block } from "./card-blocks"
import type { Structure } from "./card-structure"
import { measure, wrap } from "./text-metrics"

export interface Shape {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** The centre of a 发散 is drawn differently from the branches around it. */
  role: "block" | "centre"
}

export interface CardText {
  id: string
  x: number
  y: number
  text: string
  size: number
  bold: boolean
}

export interface Link {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  arrow: boolean
}

export interface Frame {
  w: number
  h: number
  shapes: Shape[]
  texts: CardText[]
  links: Link[]
}

/** Below this a card cannot hold two columns, and every skeleton degrades to
 *  one -- which is the 方框长条 this whole module exists to avoid. No maximum. */
const minWidth = 640
const pad = 32
const gap = 24
const boxPad = 14
const titleSize = 17
const bodySize = 14
const lineGap = 6
/** Three at most: a nine-item list should read as 3×3, not as a nine-wide strip
 *  whose boxes are too narrow to hold a sentence. */
const maxColumns = 3

/**
 * The longest line a column is allowed to draw, in characters.
 *
 * "Do not lock the dimensions" is about *height*. Left unlocked on both axes it
 * defeats itself: a column is sized to its widest line, so one long sentence
 * would widen the card until that sentence fit on a single line -- 3000px for a
 * 200-character paragraph. That is still 方框长条, just lying down.
 *
 * Bounding the column is what puts `wrap` to work, and once text wraps the
 * overflow lands in `blockHeight`, which the card already absorbs by growing.
 * So this constant is not a cap on content; it is the hinge that redirects
 * content from the axis with no answer to the axis that has one.
 *
 * 34 is the reading measure, not a pixel count that happened to look right: CJK
 * body text is set at 30-45 characters per line, and the pixel budget follows
 * from the font size rather than the other way round. Latin gets more
 * characters for the same width because it advances narrower -- correctly so,
 * since the measure that matters is the line's length on screen.
 */
const maxLineCharacters = 34
const maxColumnWidth = maxLineCharacters * bodySize + boxPad * 2

/** Ring boxes are satellites, so they are held to a tighter measure than a
 *  grid column: the radius grows with the box, and a wide box pushes every
 *  other box outward for no gain in readability. */
const maxRingBoxWidth = 260

function lineHeight(size: number): number {
  return size + lineGap
}

/**
 * Where the ray from a box's centre toward (tx, ty) crosses that box's border.
 *
 * Boxes paint over links -- which is right, a diagram is boxes joined by lines,
 * not boxes sitting on a web. But it means a link drawn centre-to-centre
 * disappears under both ends, and the arrowhead with it. That head is the only
 * thing distinguishing a 循环 from a ring of plain lines, so burying it deletes
 * exactly the half of the information the structure was chosen to carry, and
 * deletes it invisibly: the picture still looks finished.
 *
 * Trimming here rather than with a z-index or a clip path keeps it arithmetic,
 * so `card-layout.test` can see it with no renderer at all -- the same reason
 * every other measurement in this module is computed instead of measured.
 */
function edgePoint(shape: Shape, tx: number, ty: number): { x: number; y: number } {
  const cx = shape.x + shape.w / 2
  const cy = shape.y + shape.h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  // The border is met on whichever axis runs out of room first.
  const scale = Math.min(
    dx === 0 ? Infinity : shape.w / 2 / Math.abs(dx),
    dy === 0 ? Infinity : shape.h / 2 / Math.abs(dy),
  )
  return { x: cx + dx * scale, y: cy + dy * scale }
}

/** A link between two boxes, trimmed so both ends stay visible. */
function join(from: Shape, to: Shape, arrow: boolean): Link {
  const fromCentre = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const toCentre = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
  const start = edgePoint(from, toCentre.x, toCentre.y)
  const end = edgePoint(to, fromCentre.x, fromCentre.y)
  return {
    id: arrow ? `${from.id}->${to.id}` : `${from.id}-${to.id}`,
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    arrow,
  }
}

/** Everything this block says, as the lines it will actually draw. */
function blockLines(block: Block, innerWidth: number): string[] {
  return [
    ...block.lines.flatMap((line) => wrap(line, bodySize, innerWidth)),
    ...block.fields.flatMap((field) => wrap(`${field.name}：${field.value}`, bodySize, innerWidth)),
    ...block.children
      .map((child) => `· ${child.title}`)
      .flatMap((line) => wrap(line, bodySize, innerWidth)),
  ]
}

function blockHeight(block: Block, boxWidth: number): number {
  const innerWidth = boxWidth - boxPad * 2
  const titleLines = wrap(block.title, titleSize, innerWidth).length
  const bodyLines = blockLines(block, innerWidth).length
  return boxPad * 2 + titleLines * lineHeight(titleSize) + bodyLines * lineHeight(bodySize)
}

/** How wide this block would like to be, before any grid is imposed on it. */
function naturalWidth(block: Block): number {
  const candidates = [
    measure(block.title, titleSize),
    ...block.lines.map((line) => measure(line, bodySize)),
    ...block.fields.map((field) => measure(`${field.name}：${field.value}`, bodySize)),
    ...block.children.map((child) => measure(`· ${child.title}`, bodySize)),
  ]
  return Math.max(...candidates, 0) + boxPad * 2
}

/** Draw one block's title and body into a box already placed at (x, y). */
function paint(block: Block, shape: Shape, texts: CardText[]): void {
  const innerWidth = shape.w - boxPad * 2
  let cursor = shape.y + boxPad + titleSize
  let index = 0
  for (const line of wrap(block.title, titleSize, innerWidth)) {
    texts.push({
      id: `${block.id}-t${index}`,
      x: shape.x + boxPad,
      y: cursor,
      text: line,
      size: titleSize,
      bold: true,
    })
    cursor += lineHeight(titleSize)
    index += 1
  }
  index = 0
  for (const line of blockLines(block, innerWidth)) {
    texts.push({
      id: `${block.id}-b${index}`,
      x: shape.x + boxPad,
      y: cursor,
      text: line,
      size: bodySize,
      bold: false,
    })
    cursor += lineHeight(bodySize)
    index += 1
  }
}

/** 并列 and 流程: a grid, arrows only for the latter. */
function layoutGrid(blocks: Block[], arrows: boolean): Frame {
  const columns = Math.min(blocks.length, maxColumns)
  const widest = Math.min(Math.max(...blocks.map(naturalWidth)), maxColumnWidth)
  const needed = pad * 2 + columns * widest + gap * (columns - 1)
  const w = Math.max(minWidth, needed)
  // Slack is given back to the boxes rather than left as margin: a card with
  // 200px columns floating in 640px of white reads as a mistake.
  const boxWidth = Math.floor((w - pad * 2 - gap * (columns - 1)) / columns)

  const shapes: Shape[] = []
  const texts: CardText[] = []
  const links: Link[] = []
  let y = pad

  for (let start = 0; start < blocks.length; start += columns) {
    const row = blocks.slice(start, start + columns)
    const rowHeight = Math.max(...row.map((block) => blockHeight(block, boxWidth)))
    row.forEach((block, column) => {
      const shape: Shape = {
        id: block.id,
        x: pad + column * (boxWidth + gap),
        y,
        w: boxWidth,
        h: rowHeight,
        role: "block",
      }
      shapes.push(shape)
      paint(block, shape, texts)
    })
    y += rowHeight + gap
  }

  if (arrows) {
    for (let index = 0; index + 1 < shapes.length; index += 1) {
      const from = shapes[index]
      const to = shapes[index + 1]
      const sameRow = from.y === to.y
      links.push({
        id: `${from.id}->${to.id}`,
        // Within a row the arrow runs along the gap; across a row break it
        // drops from the bottom of the last box to the top of the next.
        x1: sameRow ? from.x + from.w : from.x + from.w / 2,
        y1: sameRow ? from.y + from.h / 2 : from.y + from.h,
        x2: sameRow ? to.x : to.x + to.w / 2,
        y2: sameRow ? to.y + to.h / 2 : to.y,
        arrow: true,
      })
    }
  }

  return { w, h: y - gap + pad, shapes, texts, links }
}

/**
 * 循环 and 发散: boxes on a circle.
 *
 * The radius is forced by geometry, not chosen. Two axis-aligned boxes overlap
 * only if their centres are closer than `w` horizontally *and* closer than `h`
 * vertically, so centres one diagonal apart can never overlap whatever the
 * angle -- `hypot(w, h)` is the one spacing that holds for every rotation.
 * Adjacent centres on a ring of `n` sit a chord `2r·sin(π/n)` apart, so
 * `r ≥ (hypot(w, h) + gap) / (2·sin(π/n))`.
 *
 * Sizing by `max(w, h)` instead would be wrong by exactly the amount that
 * bites: three 260×100 boxes land 235px apart when they need 260, and the
 * "never overlaps" assertion fails at n=3 only. This is the same "compute it,
 * do not cap it" move as the grid's height -- a twelve-step cycle draws a big
 * ring rather than twelve boxes on top of each other.
 */
function layoutRing(blocks: Block[], centre: Block | null, arrows: boolean): Frame {
  const boxWidth = Math.min(Math.max(...blocks.map(naturalWidth)), maxRingBoxWidth)
  const heights = blocks.map((block) => blockHeight(block, boxWidth))
  const boxHeight = Math.max(...heights)
  const centreWidth = centre ? Math.min(naturalWidth(centre), 320) : 0
  const centreHeight = centre ? blockHeight(centre, centreWidth) : 0

  // max(n, 2) because sin(π/1) is 0 and would divide by zero. `classify` never
  // returns a ring for one block, but a layout function that explodes on an
  // input its caller happens not to send is a trap left for the next phase.
  const spread = Math.max(blocks.length, 2)
  const bySpacing = (Math.hypot(boxWidth, boxHeight) + gap) / (2 * Math.sin(Math.PI / spread))
  // Also has to clear the centre box, plus half of a branch box, plus the gap.
  const byCentre =
    Math.hypot(centreWidth, centreHeight) / 2 + gap + Math.hypot(boxWidth, boxHeight) / 2
  const radius = Math.max(bySpacing, byCentre)

  // Any origin does: the drawing is moved onto its own frame below, once the
  // frame is known.
  const cx = pad + radius + boxWidth / 2
  const cy = pad + radius + boxHeight / 2

  const shapes: Shape[] = []
  const texts: CardText[] = []
  const links: Link[] = []

  if (centre) {
    const shape: Shape = {
      id: centre.id,
      x: cx - centreWidth / 2,
      y: cy - centreHeight / 2,
      w: centreWidth,
      h: centreHeight,
      role: "centre",
    }
    shapes.push(shape)
    paint(centre, shape, texts)
  }

  const ring: Shape[] = []
  blocks.forEach((block, index) => {
    // Starting at the top and going clockwise, because that is where a reader
    // starts on a clock and on every cycle diagram ever drawn.
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / blocks.length
    const shape: Shape = {
      id: block.id,
      x: cx + Math.cos(angle) * radius - boxWidth / 2,
      y: cy + Math.sin(angle) * radius - boxHeight / 2,
      w: boxWidth,
      h: boxHeight,
      role: "block",
    }
    ring.push(shape)
    shapes.push(shape)
    paint(block, shape, texts)
  })

  // The frame is the bounding box of what was drawn, not of the circle it was
  // drawn on -- and for an odd number of boxes those differ badly. Three
  // branches reach the top of the circle but only half a radius below its
  // centre, so reserving the circle's box left 150px of white below the
  // drawing: a third of an 863px card, which the reader has to scroll past to
  // find out there is nothing in it. Moving the drawing onto its own frame
  // afterwards keeps the geometry above free to work in circle coordinates.
  const left = Math.min(...shapes.map((shape) => shape.x))
  const top = Math.min(...shapes.map((shape) => shape.y))
  const right = Math.max(...shapes.map((shape) => shape.x + shape.w))
  const bottom = Math.max(...shapes.map((shape) => shape.y + shape.h))
  const w = Math.max(minWidth, right - left + pad * 2)
  const h = bottom - top + pad * 2
  // Centred when `minWidth` wins, so the slack sits on both sides rather than
  // leaving the drawing pinned to the left edge of an over-wide card.
  const dx = (w - (right - left)) / 2 - left
  const dy = pad - top
  for (const shape of shapes) {
    shape.x += dx
    shape.y += dy
  }
  for (const text of texts) {
    text.x += dx
    text.y += dy
  }

  // Links after the move, so they are computed from where the boxes ended up.
  if (centre) {
    const hub = shapes[0]
    for (const shape of ring) {
      links.push(join(hub, shape, false))
    }
  }

  if (arrows) {
    ring.forEach((from, index) => {
      links.push(join(from, ring[(index + 1) % ring.length], true))
    })
  }

  return { w, h, shapes, texts, links }
}

/**
 * @param blocks the card's top-level units
 * @param structure what `classify` read them as
 * @param centre the prose written above them -- becomes 发散's hub
 */
export function layoutCard(blocks: Block[], structure: Structure, centre: string[]): Frame {
  if (blocks.length === 0) return { w: minWidth, h: 0, shapes: [], texts: [], links: [] }

  if (structure === "循环") return layoutRing(blocks, null, true)
  if (structure === "发散") {
    const hub: Block = {
      id: "centre",
      title: centre[0] ?? "",
      lines: centre.slice(1),
      fields: [],
      ordered: false,
      children: [],
    }
    return layoutRing(blocks, hub, false)
  }
  return layoutGrid(blocks, structure === "流程")
}
