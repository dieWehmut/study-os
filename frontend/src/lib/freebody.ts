/** Which of the two lists a force belongs to when you draw it. */
export type ForceKind = "contact" | "field"

export interface Force {
  id: string
  name: string
  /** Newtons. */
  magnitude: number
  /** Degrees, 0 pointing right, counter-clockwise positive. */
  angle: number
  kind: ForceKind
}

export interface Resultant {
  x: number
  y: number
  magnitude: number
  /** Degrees in [0, 360), or null: a zero resultant points nowhere. */
  angle: number | null
  balanced: boolean
}

/**
 * How small a residue still counts as 平衡, relative to the largest force.
 *
 * Relative rather than absolute: 0.001 N left over between two 1000 N forces
 * is rounding, and the same 0.001 N between two 0.002 N ones is the answer. A
 * fixed epsilon has to be wrong about one of those.
 */
const balanceTolerance = 1e-6

const toRadians = Math.PI / 180

/**
 * Add the forces as vectors.
 *
 * The reason this is worth code at all is that adding the magnitudes is the
 * mistake -- 3 N right and 4 N up is 5 N, and every student who writes 7 N
 * knows the formula and drew no diagram.
 */
export function resolveForces(forces: Force[]): Resultant {
  let x = 0
  let y = 0
  let largest = 0
  for (const force of forces) {
    x += force.magnitude * Math.cos(force.angle * toRadians)
    y += force.magnitude * Math.sin(force.angle * toRadians)
    largest = Math.max(largest, Math.abs(force.magnitude))
  }
  const magnitude = Math.hypot(x, y)
  const balanced = magnitude <= largest * balanceTolerance
  return {
    x,
    y,
    magnitude,
    // A balanced body is not being pushed anywhere, and the residue's
    // direction is floating-point noise -- naming it would invent a direction.
    angle: balanced ? null : normalizeAngle(Math.atan2(y, x) / toRadians),
    balanced,
  }
}

/** Every angle on one circle, so 270 and -90 cannot sort or draw differently. */
function normalizeAngle(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/**
 * What the drawing is probably still missing.
 *
 * Two checks, both for mistakes you cannot see by looking at your own diagram
 * -- which is the only kind worth a warning. Everything else 物理 gets wrong is
 * visible once it is drawn, and a warning about it would just be noise on top
 * of an answer already on screen.
 */
export function checkForces(forces: Force[]): string[] {
  if (forces.length === 0) return []

  const warnings: string[] = []
  if (!forces.some((force) => force.kind === "field")) {
    warnings.push("还没有标场力 —— 重力是唯一没有接触面提醒你的力。")
  }

  // Two contact forces along one line is almost always one surface counted
  // twice under two names. A field force is exempt: 重力 and a downward
  // 支持力 are genuinely two things.
  const byDirection = new Map<number, Force[]>()
  for (const force of forces) {
    if (force.kind !== "contact" || force.magnitude === 0) continue
    const line = Math.round(normalizeAngle(force.angle))
    byDirection.set(line, [...(byDirection.get(line) ?? []), force])
  }
  for (const sharing of byDirection.values()) {
    if (sharing.length < 2) continue
    warnings.push(`${sharing.map((force) => force.name).join("、")} 方向相同 —— 同一个接触面容易被写成两个力。`)
  }
  return warnings
}
