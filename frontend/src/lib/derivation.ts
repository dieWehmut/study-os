/**
 * A written-out derivation, checked line against line.
 *
 * 定位到出错的那一步，而不是整题重做 is not something you can do by re-reading:
 * every line after the wrong one looks consistent with the line above it, so
 * the eye slides past the break. What finds it is checking each step against
 * the one before, and stopping at the first that does not follow.
 */

export type StepVerdict = "start" | "follows" | "diverges" | "unreadable" | "unchecked"

export interface StepCheck {
  text: string
  verdict: StepVerdict
  /** Why it does not follow, or could not be read. Null when nothing is wrong. */
  note: string | null
}

export interface DerivationCheck {
  steps: StepCheck[]
  /** The first line that does not follow from the one above, or null. */
  divergedAt: number | null
}

/** A line, ready to be evaluated at as many sample points as we like. */
interface Compiled {
  evaluate: (env: Record<string, number>) => number
  names: string[]
  /** Whether the line was written with an equals sign. */
  isEquation: boolean
  /** The values this line pins its variables to, when it is `x = 2`. */
  solution: Record<string, number> | null
}

type Node = (env: Record<string, number>) => number

interface State {
  text: string
  index: number
  names: Set<string>
}

class ParseError extends Error {}

// 高中 derivations reach for these constantly, and a board that rejects the
// line as unreadable is worse than no board.
const functions = new Map<string, (value: number) => number>([
  ["sqrt", Math.sqrt],
  ["sin", Math.sin],
  ["cos", Math.cos],
  ["tan", Math.tan],
  ["ln", Math.log],
  ["lg", Math.log10],
  ["abs", Math.abs],
])

function parseExpression(state: State): Node {
  let left = parseTerm(state)
  for (;;) {
    const character = state.text[state.index]
    if (character !== "+" && character !== "-") return left
    state.index += 1
    const right = parseTerm(state)
    const previous = left
    left = character === "+"
      ? (env) => previous(env) + right(env)
      : (env) => previous(env) - right(env)
  }
}

function parseTerm(state: State): Node {
  let left = parsePower(state)
  for (;;) {
    const character = state.text[state.index]
    const explicit = character === "*" || character === "/"
    // 2x and x(y+1) are multiplication as written on paper. Without this the
    // board would only read lines nobody writes.
    const implicit = character !== undefined && /[0-9.A-Za-z(]/.test(character)
    if (!explicit && !implicit) return left
    if (explicit) state.index += 1
    const right = parsePower(state)
    const previous = left
    left = character === "/"
      ? (env) => previous(env) / right(env)
      : (env) => previous(env) * right(env)
  }
}

// Right associative, and bound tighter than unary minus, so -x^2 is -(x^2).
function parsePower(state: State): Node {
  const base = parseUnary(state)
  if (state.text[state.index] !== "^") return base
  state.index += 1
  const exponent = parsePower(state)
  return (env) => Math.pow(base(env), exponent(env))
}

function parseUnary(state: State): Node {
  const character = state.text[state.index]
  if (character === "-") {
    state.index += 1
    const inner = parseUnary(state)
    return (env) => -inner(env)
  }
  if (character === "+") {
    state.index += 1
    return parseUnary(state)
  }
  return parsePrimary(state)
}

function parsePrimary(state: State): Node {
  const character = state.text[state.index]
  if (character === undefined) throw new ParseError("这一行没写完")

  if (character === "(") {
    state.index += 1
    const inner = parseExpression(state)
    if (state.text[state.index] !== ")") throw new ParseError("括号不成对")
    state.index += 1
    return inner
  }

  if (/[0-9.]/.test(character)) {
    let digits = ""
    while (state.index < state.text.length && /[0-9.]/.test(state.text[state.index] as string)) {
      digits += state.text[state.index]
      state.index += 1
    }
    const value = Number(digits)
    if (!Number.isFinite(value)) throw new ParseError(`看不懂的数字：${digits}`)
    return () => value
  }

  if (/[A-Za-z]/.test(character)) {
    let letters = ""
    let ahead = state.index
    while (ahead < state.text.length && /[A-Za-z]/.test(state.text[ahead] as string)) {
      letters += state.text[ahead]
      ahead += 1
    }
    const call = functions.get(letters)
    if (call && state.text[ahead] === "(") {
      state.index = ahead + 1
      const argument = parseExpression(state)
      if (state.text[state.index] !== ")") throw new ParseError("括号不成对")
      state.index += 1
      return (env) => call(argument(env))
    }
    // A variable is one letter: xy is x times y, the way it is written. Names
    // of more than one letter would make 2ab ambiguous with a variable ab.
    state.index += 1
    state.names.add(character)
    return (env) => env[character] ?? Number.NaN
  }

  throw new ParseError(`看不懂的写法：${character}`)
}

function compile(raw: string): Compiled | string {
  const text = raw.replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")")
  if (text === "") return "这一行是空的"

  const sides = text.split("=")
  if (sides.length > 2) return "一行里只能有一个等号"

  const names = new Set<string>()
  try {
    const nodes = sides.map((side) => {
      if (side === "") throw new ParseError("等号旁边少了一边")
      const state: State = { text: side, index: 0, names }
      const node = parseExpression(state)
      if (state.index !== side.length) {
        throw new ParseError(`看不懂的写法：${side.slice(state.index)}`)
      }
      return node
    })

    const [left, right] = nodes as [Node, Node | undefined]
    if (right === undefined) {
      return { evaluate: left, names: [...names], isEquation: false, solution: null }
    }

    // `x = 2` is a line that fixes a variable rather than one that transforms
    // the line above, and reading it as a transformation is what makes every
    // solved quadratic look like a mistake.
    const pinned = sides[0] as string
    const value = /^[A-Za-z]$/.test(pinned) ? right({}) : Number.NaN

    return {
      // An equation is carried around as lhs - rhs, which is zero exactly where
      // the equation holds -- one number per sample point either way.
      evaluate: (env) => left(env) - right(env),
      names: [...names],
      isEquation: true,
      solution: Number.isFinite(value) ? { [pinned]: value } : null,
    }
  } catch (error) {
    if (error instanceof ParseError) return error.message
    throw error
  }
}

const rounds = 6

/**
 * Sample points for the variables, the same ones every time.
 *
 * Deterministic on purpose: a check that changes its mind between two renders
 * of the same derivation is worse than no check. The values stay away from 0
 * and 1, where x² = x and x/x = 1 make a wrong step look right.
 */
function sample(names: string[], round: number): Record<string, number> {
  let seed = (round + 1) * 7919
  const env: Record<string, number> = {}
  for (const name of names) {
    seed = (seed * 48271) % 2147483647
    env[name] = 1.3 + (seed / 2147483647) * 3.1
  }
  return env
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
}

function isZero(value: number): boolean {
  return Math.abs(value) <= 1e-9
}

/**
 * Whether one line says the same thing as the line above it.
 *
 * Two expressions are identical iff they agree everywhere, so agreeing at a
 * handful of arbitrary points is enough -- nobody writes two different
 * polynomials by accident that happen to meet at all six.
 *
 * Equations are compared up to a constant factor, because dividing both sides
 * by 2 is a step and not a mistake. Bare expressions are compared exactly, for
 * the same reason: without an equals sign, halving the line changes its value.
 */
function follows(previous: Compiled, next: Compiled): boolean {
  // A line that solves for a variable narrows the solution set instead of
  // preserving it -- x = 2 drops the x = 3 branch -- so it is checked the way
  // you were taught to check it: 代入 the answer and see if the line above
  // comes out zero.
  if (next.solution !== null && previous.isEquation) {
    const residue = previous.evaluate({ ...sample(previous.names, 0), ...next.solution })
    return Number.isFinite(residue) ? isZero(residue) : true
  }

  const names = [...new Set([...previous.names, ...next.names])]
  const scalable = previous.isEquation && next.isEquation
  let ratio: number | null = null

  for (let round = 0; round < rounds; round += 1) {
    const env = sample(names, round)
    const before = previous.evaluate(env)
    const after = next.evaluate(env)
    // A sample point where either line is undefined -- a zero denominator, the
    // root of a negative -- says nothing about the step. Skip it.
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue

    if (!scalable) {
      if (!close(before, after)) return false
      continue
    }
    if (isZero(before) !== isZero(after)) return false
    if (isZero(before)) continue
    const scale = before / after
    if (ratio === null) ratio = scale
    else if (!close(ratio, scale)) return false
  }

  return true
}

export function checkDerivation(lines: string[]): DerivationCheck {
  const steps: StepCheck[] = []
  let previous: Compiled | null = null
  let divergedAt: number | null = null
  let stopped = false

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] as string
    if (stopped) {
      steps.push({ text, verdict: "unchecked", note: null })
      continue
    }

    const compiled = compile(text)
    if (typeof compiled === "string") {
      // Not a mistake in the derivation -- a mistake in the typing. Calling it
      // 出错的那一步 would point at the wrong thing.
      steps.push({ text, verdict: "unreadable", note: compiled })
      stopped = true
      continue
    }

    if (previous === null) {
      steps.push({ text, verdict: "start", note: null })
      previous = compiled
      continue
    }

    if (follows(previous, compiled)) {
      steps.push({ text, verdict: "follows", note: null })
      previous = compiled
      continue
    }

    steps.push({ text, verdict: "diverges", note: "这一步和上一步不等价" })
    divergedAt = index
    stopped = true
  }

  return { steps, divergedAt }
}
