/**
 * Which of the shapes this material is.
 *
 * Four of the ten, and they are not four pieces of code. `structures.md` §1.1
 * gives a derivation law -- 并列 is the root; 流程 is 并列 plus arrows and
 * numbering; 循环 is 流程 plus closure; 发散 is 并列 plus a centre. So the
 * classifier answers three yes/no questions, and the layout has two geometries
 * rather than four.
 *
 * Every unanswerable case falls back to 并列. The skill itself writes that any
 * 并列 skeleton plus arrows is a legal 流程 skeleton, which makes 并列 the safe
 * answer by construction -- and that is what guarantees this always draws
 * something. For a tool whose whole purpose is lowering the cost of starting to
 * read, "sometimes there is no picture" is far worse than "sometimes the
 * picture is an ordinary one."
 */

import type { Block } from "./card-blocks"

export type Structure = "并列" | "流程" | "循环" | "发散" | "层级"

/** The arrows people actually type in study material. */
const arrow = /→|⇒|⟶|->|=>|➜/
/**
 * A last step that says it goes back.
 *
 * 循环 vs 流程 turns entirely on whether the end meets the beginning
 * (`structures.md` §1.3), and in plain markdown the author says so in words.
 */
const returnMark = /回到|重新|下一轮|周而复始|循环|复始/

function textOf(block: Block): string {
  return [block.title, ...block.lines, ...block.fields.map((field) => field.value)].join(" ")
}

/** Numbered, or drawn with arrows: either is the mark of a sequence. */
function isSequence(blocks: Block[]): boolean {
  const numbered = blocks.filter((block) => block.ordered).length
  if (numbered >= 2) return true
  return blocks.filter((block) => arrow.test(textOf(block))).length >= 2
}

/**
 * Whether the last step meets the first.
 *
 * Two readings, because authors write it both ways: naming the first step again
 * at the end, or just saying 「回到」. The name test needs the first title to be
 * a real word -- a one-character title would match almost any sentence.
 */
function isClosed(blocks: Block[]): boolean {
  const last = blocks[blocks.length - 1]
  if (returnMark.test(textOf(last))) return true
  const first = blocks[0].title
  return [...first].length >= 2 && textOf(last).includes(first)
}

/**
 * How much a node can carry and still belong on a ring.
 *
 * A ring is not just another arrangement of the same boxes. Its budget is a
 * circumference, and the radius that keeps `n` boxes apart grows with the box's
 * diagonal, so a paragraph-sized node does not merely look wrong -- it pushes
 * every other node outward too. Measured on sample/distill, the heaviest ring
 * came out 8357px wide, against 1624 for every single grid.
 *
 * The number is low because the corpus says it has to be: of the 48 files that
 * read as 发散 before this guard, **not one** had a heaviest block under 4
 * lines. The median was 14 and the maximum 72. So this is not a threshold that
 * splits the population -- it is the finding that real study material has
 * section-sized children at the top level, and sections belong in a grid.
 *
 * `structures.md` agrees on the substance: 发散's branches are 主题词 and 循环's
 * steps are stages. Neither is a paragraph.
 */
const ringNodeLines = 3

function weightOf(block: Block): number {
  return block.lines.length + block.fields.length + block.children.length
}

function fitsOnARing(blocks: Block[]): boolean {
  return blocks.every((block) => weightOf(block) <= ringNodeLines)
}

/**
 * Whether a child has words the grid will not draw.
 *
 * A grid box writes each child in as a `· 标题` bullet and then drops everything
 * else about it -- its own prose, its named values, its children. So on layered
 * material the card loses a level without leaving a mark: across sample/distill
 * 23716 lines never reach the drawing, and the picture still looks finished.
 * `structures.md` §1.4 hands 层级 exactly this encoding -- 「只用量的差异(…嵌套
 * 深度)编码等级」 -- so the depth the grid discards is what this structure draws.
 *
 * The test is the buried text, not the presence of a grandchild, and the
 * difference is the whole predicate. I wrote the grandchild version first and
 * the browser caught it: in an ordinary `#/##/###` document the third level's
 * content is *prose*, so 「### 名词」 + 「表示人或事物的名称。」 has no grandchild
 * anywhere, and the most natural shape study material takes fell straight
 * through -- while the grid still drew `· 名词` and dropped the definition.
 *
 * A child with nothing but a title stays in a grid, correctly: `· 一` has
 * already said everything 一 has to say, and a tree would spread the same words
 * over five times the height.
 */
function hasBuriedText(blocks: Block[]): boolean {
  return blocks.some((block) =>
    block.children.some(
      (child) => child.lines.length > 0 || child.fields.length > 0 || child.children.length > 0,
    ),
  )
}

/**
 * How many boxes a tree may stack and still be one picture.
 *
 * Derived from the geometry, because the corpus has no members in range to
 * derive it from. A box costs `boxPad * 2` (28) plus one title line (23) at the
 * very least, and stacked boxes are `gap` (24) apart, so every node in the
 * vertical run costs 75px of card. A card that a reader still takes in as one
 * drawing runs to about 1600px -- the grids across sample/distill top out at
 * 1945 and 阅读's card was 863 -- which affords about 21.
 *
 * This is the ring's lesson arriving a second time, and I got it wrong once on
 * the way: a tree's height is *linear* in its leaves while a ring's radius is
 * superlinear, so I argued a tree needed no budget at all. Asymptotics were the
 * wrong thing to compare. Measured, the smallest tree in the corpus is 23 boxes
 * and 10575px, the largest 65137px, and the same document as a grid is 1830px --
 * because a grid packs three boxes to a row and folds a node's children into
 * bullets *inside* one box, while a tree gives every node a row of its own.
 *
 * Falling back to 并列 costs nothing that was working: the grid is what these
 * documents already draw. So the budget can only ever prevent a 10575px wall.
 * What it does mean is that 层级 fires on almost nothing in sample/distill --
 * correctly, since those are engineering documents. 层级 is for a taxonomy
 * (词类 → 实词 → 名词), which is made of names and is small.
 */
const treeNodeBudget = 21

/** Boxes a tree would draw: three levels, and everything under them folds in. */
function treeNodes(block: Block, level: number): number {
  if (level >= 2) return 1
  return 1 + block.children.reduce((total, child) => total + treeNodes(child, level + 1), 0)
}

function fitsInATree(blocks: Block[]): boolean {
  return blocks.reduce((total, block) => total + treeNodes(block, 0), 0) <= treeNodeBudget
}

/**
 * @param blocks the card's top-level units
 * @param centre the prose written above them -- the root's own body
 */
export function classify(blocks: Block[], centre: string[]): Structure {
  // One box is not a structure, and neither is none.
  if (blocks.length < 2) return "并列"

  // Falling back along the derivation law rather than out of it: a heavy cycle
  // keeps its numbering and arrows as a 流程 and loses only the one arrow that
  // wrapped around. That is a bounded loss, and the alternative is a ring no
  // one can read.
  const ringable = fitsOnARing(blocks)
  if (isSequence(blocks)) return isClosed(blocks) && ringable ? "循环" : "流程"

  // Sequence first, and 层级 second, on the skill's own distinction: 层级 draws
  // no arrows, 「层级加箭头会被读成步骤」 (§1.3). Read the other way round, a
  // numbered hierarchy drawn as a tree loses its order -- and order is what the
  // author numbered it to say.
  //
  // Ahead of 发散 for the same reason it is ahead of 并列: a ring draws a
  // grandchild no better than a grid does, and 发散's premise is that the
  // branches are 平权 sub-topics. Branches that are themselves branching are not.
  if (hasBuriedText(blocks) && fitsInATree(blocks)) return "层级"

  // 并列 vs 发散: does the centre have anything in it? A list written under a
  // paragraph has a subject; a list written under a bare heading does not.
  return centre.length > 0 && ringable ? "发散" : "并列"
}
