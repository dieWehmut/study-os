/**
 * A 因果链, checked link against link.
 *
 * 把因果链一环一环写出来，从成因到表现，缺哪一环就是丢分点 names the failure but
 * not the way to see it: a chain with a link missing reads perfectly, because
 * every sentence in it is true on its own. What finds the gap is checking that
 * each link starts where the one above it ended.
 *
 * Which is why a link is a pair and not a node. Written as a list of nodes --
 * 太阳辐射 → 地表增温 → 空气上升 -- the chain joins up by construction and there
 * is nothing left to check. Written as 因为 X 所以 Y, the gap is exactly where
 * your Y did not become the next X, and that is the 丢分点.
 */

export interface ChainLink {
  cause: string
  effect: string
}

export type LinkVerdict = "start" | "joins" | "detached" | "empty"

export interface LinkCheck extends ChainLink {
  verdict: LinkVerdict
  /** What does not join, or which half is missing. Null when the link is sound. */
  note: string | null
}

export interface ChainCheck {
  links: LinkCheck[]
  /**
   * Every link that does not pick up where the one above left off.
   *
   * Every one, not the first: unlike a derivation, a later link is not
   * downstream of an earlier break. Each 环 is a separate claim that stands or
   * falls on its own, and the second gap is usually the one you would not have
   * found by yourself.
   */
  gaps: number[]
  /** Whether the chain runs from end to end with both halves of every link. */
  joined: boolean
}

/**
 * The comparable form of one half of a link.
 *
 * Spacing and end punctuation are how the same 环 gets written twice by the
 * same person -- 地表增温 on one line and 地表增温。 on the next -- and a check
 * that read those as different links would be wrong on every real answer.
 */
function normalize(half: string): string {
  return half.replace(/[\s。，、；：,.;:!?！？]/g, "")
}

/**
 * Whether a link's cause is the previous link's effect, restated.
 *
 * Containment either way rather than equality: an answer usually carries the
 * last result forward with more words attached -- 地表增温 becomes
 * 地表增温、空气膨胀 -- and that is the same 环 at two lengths, not a gap.
 */
function picksUp(previousEffect: string, cause: string): boolean {
  const before = normalize(previousEffect)
  const after = normalize(cause)
  if (before === "" || after === "") return false
  return after.includes(before) || before.includes(after)
}

export function checkChain(links: ChainLink[]): ChainCheck {
  const checked: LinkCheck[] = []
  const gaps: number[] = []
  // The last effect worth measuring against. Null until a link has both halves,
  // so an unfinished line is one problem and not two: the link below it is
  // measured against the last real result, never against a blank.
  let previousEffect: string | null = null

  for (let index = 0; index < links.length; index += 1) {
    const link = links[index] as ChainLink

    if (normalize(link.cause) === "" || normalize(link.effect) === "") {
      // Not a gap in the reasoning -- a line you have not finished. Calling it
      // 缺一环 would send you looking for a 环 that is not missing.
      checked.push({
        ...link,
        verdict: "empty",
        note: normalize(link.cause) === "" ? "这一环还没写成因" : "这一环还没写结果",
      })
      continue
    }

    if (previousEffect === null) {
      checked.push({ ...link, verdict: "start", note: null })
      previousEffect = link.effect
      continue
    }

    if (picksUp(previousEffect, link.cause)) {
      checked.push({ ...link, verdict: "joins", note: null })
      previousEffect = link.effect
      continue
    }

    // Both ends named, because the fix is the 环 that goes between them and you
    // cannot write that from one end alone.
    checked.push({
      ...link,
      verdict: "detached",
      note: `上一环到「${link.cause}」中间还缺一环 —— 上一环停在「${previousEffect}」`,
    })
    gaps.push(index)
    previousEffect = link.effect
  }

  return {
    links: checked,
    gaps,
    joined: gaps.length === 0 && checked.every((link) => link.verdict !== "empty"),
  }
}
