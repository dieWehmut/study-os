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

  const w = Math.max(minWidth, pad * 2 + radius * 2 + boxWidth)
  const h = pad * 2 + radius * 2 + boxHeight
  const cx = w / 2
  const cy = h / 2

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

  if (centre) {
    const hub = shapes[0]
    for (const shape of ring) {
      links.push({
        id: `${hub.id}-${shape.id}`,
        x1: cx,
        y1: cy,
        x2: shape.x + shape.w / 2,
        y2: shape.y + shape.h / 2,
        arrow: false,
      })
    }
  }

  if (arrows) {
    ring.forEach((from, index) => {
      const to = ring[(index + 1) % ring.length]
      links.push({
        id: `${from.id}->${to.id}`,
        x1: from.x + from.w / 2,
        y1: from.y + from.h / 2,
        x2: to.x + to.w / 2,
        y2: to.y + to.h / 2,
        arrow: true,
      })
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
