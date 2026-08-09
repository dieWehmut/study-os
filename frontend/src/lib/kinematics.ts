/**
 * One leg of a motion problem, under constant acceleration.
 *
 * Every quantity is nullable because the whole point is that you have not
 * written them all down -- that is the mistake this exists to catch.
 */
export interface Stage {
  id: string
  name: string
  /** 初速度, m/s. */
  v0: number | null
  /** 末速度, m/s. */
  v: number | null
  /** 加速度, m/s². */
  a: number | null
  /** 时间, s. */
  t: number | null
  /** 位移, m. */
  x: number | null
}

export type Quantity = "v0" | "v" | "a" | "t" | "x"

export interface SolvedStage extends Stage {
  /** Which quantities this filled in, so the UI can say what you did not write. */
  derived: Quantity[]
}

type Known = Record<Quantity, number | null>

/**
 * One relation, read in one direction.
 *
 * Written as single steps rather than as "given v0, a and t, fill the rest"
 * because five quantities and three knowns is ten different starting hands.
 * Running the whole list until nothing new appears covers all ten, and covers
 * the chains too: v0/v/a yields t, and t is what then yields x.
 */
interface Rule {
  target: Quantity
  from: (known: Known) => number | null
}

const rules: Rule[] = [
  { target: "v", from: ({ v0, a, t }) => (v0 !== null && a !== null && t !== null ? v0 + a * t : null) },
  { target: "v0", from: ({ v, a, t }) => (v !== null && a !== null && t !== null ? v - a * t : null) },
  {
    target: "a",
    from: ({ v0, v, t }) => (v0 !== null && v !== null && t !== null && t !== 0 ? (v - v0) / t : null),
  },
  {
    target: "t",
    from: ({ v0, v, a }) => (v0 !== null && v !== null && a !== null && a !== 0 ? (v - v0) / a : null),
  },
  {
    target: "x",
    from: ({ v0, a, t }) => (v0 !== null && a !== null && t !== null ? v0 * t + 0.5 * a * t * t : null),
  },
  {
    target: "x",
    from: ({ v0, v, t }) => (v0 !== null && v !== null && t !== null ? ((v0 + v) / 2) * t : null),
  },
  // v² - v0² = 2ax, the one that works when 时间 was never mentioned.
  {
    target: "x",
    from: ({ v0, v, a }) => (v0 !== null && v !== null && a !== null && a !== 0 ? (v * v - v0 * v0) / (2 * a) : null),
  },
  {
    target: "t",
    from: ({ v0, v, x }) => (v0 !== null && v !== null && x !== null && v0 + v !== 0 ? (2 * x) / (v0 + v) : null),
  },
  {
    target: "a",
    from: ({ v0, v, x }) => (v0 !== null && v !== null && x !== null && x !== 0 ? (v * v - v0 * v0) / (2 * x) : null),
  },
]

export function solveStage(stage: Stage): SolvedStage {
  const known: Known = { v0: stage.v0, v: stage.v, a: stage.a, t: stage.t, x: stage.x }
  const derived: Quantity[] = []

  // A quantity already in hand is never recomputed, which is the whole of
  // "does not overwrite a number you wrote yourself": a written value and a
  // derived one land in the same slot, and arrival order is all that separates
  // them. Overwriting would erase the disagreement checkStages exists to find.
  let filled = true
  while (filled) {
    filled = false
    for (const rule of rules) {
      if (known[rule.target] !== null) continue
      const value = rule.from(known)
      if (value === null || !Number.isFinite(value)) continue
      known[rule.target] = value
      derived.push(rule.target)
      filled = true
    }
  }

  return { ...stage, ...known, derived }
}

/**
 * Relative, because the same board carries a 0.5 m/s 末速度 and a 600 m/s one.
 * Floored at 1 so that two quantities near zero are not held to a tolerance
 * that shrinks with them.
 */
const tolerance = 1e-9

function agrees(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * tolerance
}

function show(value: number): string {
  return String(Number(value.toFixed(2)))
}

export function checkStages(stages: SolvedStage[]): string[] {
  const warnings: string[] = []

  stages.forEach((stage, index) => {
    const { v0, v, a, t } = stage
    if (v0 !== null && v !== null && a !== null && t !== null && !agrees(v0 + a * t, v)) {
      warnings.push(`${stage.name}：v₀ + at = ${show(v0 + a * t)} m/s，和写下的末速度 ${show(v)} m/s 不一致`)
    }

    // The reason to divide the process at all: 末速度 of one stage is 初速度 of
    // the next. A blank is not a disagreement -- warning about one would make
    // the board nag while you are still filling it in.
    const previous = stages[index - 1]
    if (previous && previous.v !== null && v0 !== null && !agrees(previous.v, v0)) {
      warnings.push(
        `${stage.name} 的初速度 ${show(v0)} m/s 接不上 ${previous.name} 的末速度 ${show(previous.v)} m/s`,
      )
    }
  })

  return warnings
}
