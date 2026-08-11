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

export type Structure = "并列" | "流程" | "循环" | "发散"

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
 * @param blocks the card's top-level units
 * @param centre the prose written above them, if any -- the root's own body
 */
export function classify(blocks: Block[], centre: string[]): Structure {
  // One box is not a structure, and neither is none.
  if (blocks.length < 2) return "并列"

  if (isSequence(blocks)) return isClosed(blocks) ? "循环" : "流程"

  // 并列 vs 发散: does the centre have anything in it? A list written under a
  // paragraph has a subject; a list written under a bare heading does not.
  return centre.length > 0 ? "发散" : "并列"
}
