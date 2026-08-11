/**
 * Outline tree -> the units a card draws.
 *
 * An `OutlineNode` is what the map needs: a title and a run of prose under it.
 * A card needs two things more.
 *
 * One is which prose lines are *named values*, because geometry aligns them
 * into columns by name. `parseOutline` already found them; it just encoded them
 * as prose (a table row arrives as `["定义：mv", "例子：小球碰撞"]`, i.e. `表头：值`).
 *
 * The other is *which level to draw*. The map always starts at the root because
 * the root is where the reader starts scrolling. A card has no scroll -- it is
 * one picture -- so starting at a root with a single child would draw one box
 * with three lines in it, which is exactly the 方框长条 of 0807:41.
 */

import type { OutlineNode } from "./outline"

export interface Field {
  name: string
  value: string
}

export interface Block {
  /** The outline's id, which is derived from position and so is stable. */
  id: string
  title: string
  /** Prose that is not a named value. */
  lines: string[]
  /**
   * Named values, in document order.
   *
   * Pairs, not a positional grid. `parseOutline` drops empty cells
   * (`outline.ts` -- a half-filled table is normal and "例子：" with nothing
   * after it reads as a missing answer), so the third row's second field need
   * not share a column with the second row's second field. Geometry groups by
   * `name`, which is written on every row, rather than by index.
   */
  fields: Field[]
  ordered: boolean
  children: Block[]
}

export interface CardSource {
  /**
   * The prose written above the blocks.
   *
   * Read here rather than by the classifier, because only this module knows
   * which node it stopped at -- and 并列 vs 发散 turns on whether *that* node has
   * anything to say (`structures.md` §1.3). Two walks of the same chain would
   * drift, and the drift would be silent: the card would draw a hub with
   * nothing in it, or no hub where there was one.
   */
  centre: string[]
  blocks: Block[]
}

/**
 * How long a string can be and still read as a field name.
 *
 * Measured from the geometry rather than guessed, because the corpus cannot
 * settle it: across sample/distill's 72 files, real table headers run 2
 * characters at the median and 9 at p90, while prose written with a colon runs
 * 9 at the median. The two populations overlap exactly where a threshold would
 * have to sit, so no length tells them apart and a bigger budget only buys more
 * false positives.
 *
 * What is not a guess is the space. A name is drawn in the left column of a box
 * that is at most 260px wide with 14px padding either side, and body text is
 * 14px -- so eight CJK characters already take 112px, about half of what the
 * value has to share. Past that the column is the box.
 *
 * The failure is one-sided by design: a missed field draws as an ordinary line,
 * which is what it looked like anyway. A false field puts half a sentence in a
 * column head, and every row below it inherits that column.
 */
const nameBudget = 8

/** A colon inside running prose, told apart from a field name before one. */
const sentenceEnd = /[。！？；;]/

/**
 * Split `定义：mv` into a name and a value, or answer null.
 *
 * Unlike `outline.splitLongItem` this runs regardless of length -- 「定义：mv」 is
 * five characters and is still a named value. What it shares is the reason to
 * refuse: no colon, an empty half, a `//` after the colon (that is a URL
 * scheme, not a field name), or a name long enough to be a sentence.
 */
function readField(line: string): Field | null {
  const mark = line.search(/[：:]/)
  if (mark <= 0) return null

  const name = line.slice(0, mark).trim()
  const value = line.slice(mark + 1).trim()
  if (!name || !value || value.startsWith("//")) return null
  if ([...name].length > nameBudget || sentenceEnd.test(name)) return null

  return { name, value }
}

function toBlock(node: OutlineNode): Block {
  const lines: string[] = []
  const fields: Field[] = []
  for (const line of node.body) {
    const field = readField(line)
    if (field) fields.push(field)
    else lines.push(line)
  }
  return {
    id: node.id,
    title: node.title,
    lines,
    fields,
    ordered: node.ordered,
    children: node.children.map(toBlock),
  }
}

/**
 * Walk down while there is only one way to go.
 *
 * A lone child is not a structure -- there is nothing for it to be beside. The
 * requirement that it have children of its own is what stops the walk from
 * stepping into a leaf and leaving the card with nothing at all to draw.
 */
function deepestFork(node: OutlineNode): OutlineNode {
  let current = node
  while (current.children.length === 1 && current.children[0].children.length > 0) {
    current = current.children[0]
  }
  return current
}

export function readCard(root: OutlineNode): CardSource {
  const fork = deepestFork(root)
  return { centre: [...fork.body], blocks: fork.children.map(toBlock) }
}
