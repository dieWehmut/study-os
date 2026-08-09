/**
 * One substance on one side of an equation.
 */
export interface Species {
  /** The number written in front, 1 when nothing was written. */
  coefficient: number
  /** The formula as written, without coefficient or state symbol. */
  formula: string
  /** (s) (l) (g) (aq), or null when none was written. */
  state: string | null
  /** Element symbol to atom count, already multiplied by the coefficient. */
  atoms: Record<string, number>
}

export interface Difference {
  element: string
  left: number
  right: number
}

export interface EquationCheck {
  left: Species[]
  right: Species[]
  balanced: boolean
  /** Every element whose totals disagree, in the order first seen. */
  differences: Difference[]
  /** Formulas written with no state symbol, when some others have one. */
  missingStates: string[]
  /** Why nothing could be checked, or null when the equation parsed. */
  error: string | null
}

/**
 * The symbols a 高中 equation can legitimately contain.
 *
 * Not decoration: without it `Xy` parses as one atom of a made-up element and
 * balances happily against another `Xy`, so the check would confirm a typo.
 * A 配平 check that agrees with a mistake is worse than no check.
 */
const elements = new Set(
  ("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
    "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm " +
    "Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr")
    .split(" "),
)

// Every arrow a student might type, folded to one separator before splitting.
// = is the one 人教版 prints; the rest come from a keyboard or a copy-paste.
const arrows = ["⇌", "⇋", "<=>", "=>", "->", "→", "←", "==", "="]

const states = new Set(["s", "l", "g", "aq"])

const opens: Record<string, string> = { "(": ")", "[": "]", "（": "）" }

/**
 * Tally one formula's atoms, distributing bracket multipliers inward.
 *
 * A stack of tallies rather than recursion: a bracket's multiplier applies to
 * everything opened since its partner, and popping one level and folding it
 * into the level below is exactly that, without a parser.
 */
function countAtoms(formula: string): Record<string, number> | string {
  const stack: Record<string, number>[] = [{}]
  let index = 0

  while (index < formula.length) {
    const character = formula[index] as string

    if (character in opens) {
      stack.push({})
      index += 1
      continue
    }

    if (character === ")" || character === "]" || character === "）") {
      const inner = stack.pop()
      if (!inner || stack.length === 0) return `括号不成对：${formula}`
      index += 1
      const [multiplier, after] = readNumber(formula, index)
      index = after
      const outer = stack[stack.length - 1] as Record<string, number>
      for (const [element, count] of Object.entries(inner)) {
        outer[element] = (outer[element] ?? 0) + count * multiplier
      }
      continue
    }

    if (!/[A-Z]/.test(character)) return `看不懂的写法：${formula}`

    let symbol = character
    index += 1
    while (index < formula.length && /[a-z]/.test(formula[index] as string)) {
      symbol += formula[index]
      index += 1
    }
    if (!elements.has(symbol)) return `${symbol} 不是元素符号`

    const [count, after] = readNumber(formula, index)
    index = after
    const level = stack[stack.length - 1] as Record<string, number>
    level[symbol] = (level[symbol] ?? 0) + count
  }

  if (stack.length !== 1) return `括号不成对：${formula}`
  return stack[0] as Record<string, number>
}

/** A missing number is 1 -- H2O has one oxygen, written as nothing at all. */
function readNumber(text: string, from: number): [number, number] {
  let index = from
  while (index < text.length && /[0-9]/.test(text[index] as string)) index += 1
  if (index === from) return [1, from]
  return [Number(text.slice(from, index)), index]
}

function parseSpecies(raw: string): Species | string {
  let text = raw.trim().replace(/\s+/g, "")
  if (text === "") return "有一项是空的"

  const [coefficient, after] = readNumber(text, 0)
  text = text.slice(after)

  let state: string | null = null
  const marked = /[(（]([a-z]{1,2})[)）]$/.exec(text)
  if (marked && states.has(marked[1] as string)) {
    state = marked[1] as string
    text = text.slice(0, marked.index)
  }

  if (text === "") return "只写了系数，没写化学式"

  const atoms = countAtoms(text)
  if (typeof atoms === "string") return atoms

  const scaled: Record<string, number> = {}
  for (const [element, count] of Object.entries(atoms)) {
    scaled[element] = count * coefficient
  }

  return { coefficient, formula: text, state, atoms: scaled }
}

function parseSide(raw: string): Species[] | string {
  const parsed: Species[] = []
  for (const piece of raw.split("+")) {
    const species = parseSpecies(piece)
    if (typeof species === "string") return species
    parsed.push(species)
  }
  return parsed
}

function totals(side: Species[]): Record<string, number> {
  const sum: Record<string, number> = {}
  for (const species of side) {
    for (const [element, count] of Object.entries(species.atoms)) {
      sum[element] = (sum[element] ?? 0) + count
    }
  }
  return sum
}

function failed(error: string): EquationCheck {
  return { left: [], right: [], balanced: false, differences: [], missingStates: [], error }
}

export function checkEquation(input: string): EquationCheck {
  const text = input.trim()
  if (text === "") return failed("还没有写方程式")

  let normalised = text
  for (const arrow of arrows) {
    normalised = normalised.split(arrow).join("\u0000")
  }
  const sides = normalised.split("\u0000").filter((side) => side.trim() !== "")
  if (sides.length !== 2) return failed("写成 反应物 = 生成物 的样子，两边都要有")

  const left = parseSide(sides[0] as string)
  if (typeof left === "string") return failed(left)
  const right = parseSide(sides[1] as string)
  if (typeof right === "string") return failed(right)

  const leftTotals = totals(left)
  const rightTotals = totals(right)
  const differences: Difference[] = []
  // Left side first so the elements come out in the order the equation is
  // read. Every difference is listed, not just the first: the second is
  // usually the one you would not have found on your own.
  for (const element of [...Object.keys(leftTotals), ...Object.keys(rightTotals)]) {
    if (differences.some((entry) => entry.element === element)) continue
    const onLeft = leftTotals[element] ?? 0
    const onRight = rightTotals[element] ?? 0
    if (onLeft !== onRight) differences.push({ element, left: onLeft, right: onRight })
  }

  // 状态符号 is all-or-nothing in a marked answer, so the omission is only
  // worth naming once the equation has shown it is written in that style.
  const all = [...left, ...right]
  const missingStates = all.some((species) => species.state !== null)
    ? all.filter((species) => species.state === null).map((species) => species.formula)
    : []

  return { left, right, balanced: differences.length === 0, differences, missingStates, error: null }
}
