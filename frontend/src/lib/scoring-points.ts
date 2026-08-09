/**
 * An answer, laid against the 得分点 it was supposed to hit.
 *
 * 对着得分点拆答案：踩到几个点，缺的是哪一类 is advice you cannot follow by
 * re-reading your own answer -- it reads as complete, because you wrote every
 * sentence in it on purpose. What finds the missing 点 is holding the answer
 * against the list and asking of each point separately whether it is in there.
 */

export interface ScoringPoint {
  /** The point as written on the 答案, alternatives separated by a slash. */
  text: string
}

export type PointVerdict = "hit" | "missing"

export interface PointCheck extends ScoringPoint {
  verdict: PointVerdict
  /** The wording in your answer that matched, or null when nothing did. */
  matched: string | null
}

export interface CoverageCheck {
  points: PointCheck[]
  hit: number
  total: number
}

// Deliberately not /g: a global regex carries lastIndex between .test() calls,
// so used per character it would skip every other match.
const noise = /[\s。，、；：,.;:!?！？"'“”‘’()（）《》【】\-—…·]/

/** The answer with the punctuation dropped, and where each kept character came from. */
function strip(text: string): { kept: string; from: number[] } {
  let kept = ""
  const from: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] as string
    if (noise.test(character)) continue
    kept += character
    from.push(index)
  }
  return { kept, from }
}

/**
 * How much longer than the point itself the matching stretch of answer may run.
 *
 * A point said in your own words runs longer than the 答案's wording -- 借景抒情
 * written out as 借助景物抒发情感 -- and a check that missed that would mark a
 * correct answer down. But with no bound at all the four characters of 借景抒情
 * can be picked out of any four sentences that happen to contain them in order,
 * and then every point reads as hit and the check scores nothing.
 *
 * Twice the point's length is the line: you may say a point at double length,
 * and past that you were saying something else.
 */
const stretch = 2

/**
 * The shortest run of the answer that says the point, or null.
 *
 * In order, not merely present: 抒情借景 is not 借景抒情, and a bag-of-characters
 * rule would take one for the other.
 */
function findRun(point: string, answer: { kept: string; from: number[] }): [number, number] | null {
  let best: [number, number] | null = null

  for (let start = 0; start < answer.kept.length; start += 1) {
    if (answer.kept[start] !== point[0]) continue
    let at = 0
    let end = start
    // Greedy from a fixed start gives the earliest end, so the shortest run for
    // that start. The shortest over all starts is the shortest run there is.
    while (end < answer.kept.length && at < point.length) {
      if (answer.kept[end] === point[at]) at += 1
      end += 1
    }
    if (at < point.length) continue
    const span = end - start
    if (span > point.length * stretch) continue
    if (best === null || span < best[1] - best[0]) best = [start, end]
  }

  return best
}

function match(point: string, original: string, answer: { kept: string; from: number[] }): string | null {
  const wanted = strip(point).kept
  if (wanted === "" || answer.kept === "") return null

  const run = findRun(wanted, answer)
  if (run === null) return null

  // Sliced out of what you actually wrote, punctuation and all: the snippet is
  // shown back to you, and a de-punctuated one reads as something you did not
  // write.
  const first = answer.from[run[0]] as number
  const last = answer.from[run[1] - 1] as number
  return original.slice(first, last + 1)
}

export function checkCoverage(points: ScoringPoint[], answer: string): CoverageCheck {
  const stripped = strip(answer)

  const checked: PointCheck[] = points.map((point) => {
    // 答案 are written with alternatives -- 对比/衬托 -- and one of them being in
    // your answer is the whole point scored, not half of it.
    const alternatives = point.text.split(/[/／]/)
    let matched: string | null = null
    for (const alternative of alternatives) {
      const found = match(alternative, answer, stripped)
      if (found !== null && (matched === null || found.length < matched.length)) matched = found
    }
    return { ...point, verdict: matched === null ? "missing" : "hit", matched }
  })

  return {
    points: checked,
    hit: checked.filter((point) => point.verdict === "hit").length,
    total: checked.length,
  }
}
