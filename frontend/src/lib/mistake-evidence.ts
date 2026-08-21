export type SubjectEvidenceSubject =
  | "chinese"
  | "math"
  | "english"
  | "physics"
  | "chemistry"
  | "geography"

export interface ScoringPointsEvidence {
  version: 1
  subject: "chinese"
  tool: "scoring_points"
  data: { points: string[]; answer: string }
}

export interface DerivationEvidence {
  version: 1
  subject: "math"
  tool: "derivation"
  data: { lines: string[] }
}

export interface LongSentenceEvidence {
  version: 1
  subject: "english"
  tool: "long_sentence"
  data: { sentence: string }
}

export interface FreeBodyEvidence {
  version: 1
  subject: "physics"
  tool: "free_body"
  data: {
    forces: Array<{
      id: string
      name: string
      magnitude: number
      angle: number
      kind: "contact" | "field"
    }>
  }
}

export type MotionQuantity = "v0" | "v" | "a" | "t" | "x"

export interface MotionEvidence {
  version: 1
  subject: "physics"
  tool: "motion"
  data: {
    stages: Array<{
      id: string
      name: string
      v0?: number | null
      v?: number | null
      a?: number | null
      t?: number | null
      x?: number | null
      derived?: MotionQuantity[] | null
    }>
  }
}

export interface EquationEvidence {
  version: 1
  subject: "chemistry"
  tool: "equation"
  data: { equation: string }
}

export interface CausalChainEvidence {
  version: 1
  subject: "geography"
  tool: "causal_chain"
  data: { links: Array<{ cause: string; effect: string }> }
}

export type MistakeEvidence =
  | ScoringPointsEvidence
  | DerivationEvidence
  | LongSentenceEvidence
  | FreeBodyEvidence
  | MotionEvidence
  | EquationEvidence
  | CausalChainEvidence

export type SubjectAttemptEvidence = MistakeEvidence

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function invalid(message: string): never {
  throw new Error(`subject attempt evidence: ${message}`)
}

/**
 * Validate the versioned, subject-specific artifact shared by the backend and
 * the GitHub Pages adapter. An empty object is the wire representation for a
 * legacy attempt that has no artifact yet.
 */
export function normalizeSubjectAttemptEvidence(
  questionSubject: string,
  raw: unknown,
): MistakeEvidence | undefined {
  if (raw === undefined || raw === null || (isRecord(raw) && Object.keys(raw).length === 0)) return undefined
  if (!isRecord(raw)) invalid("must be an object")
  if (!hasOnlyKeys(raw, ["version", "subject", "tool", "data"])) invalid("contains an unknown field")

  const version = raw.version
  const subject = typeof raw.subject === "string" ? raw.subject.trim().toLowerCase() : ""
  const tool = typeof raw.tool === "string" ? raw.tool.trim().toLowerCase() : ""
  const expectedSubject = questionSubject.trim().toLowerCase()
  if (version !== 1) invalid("version must be 1")
  if (!subject || subject !== expectedSubject) invalid("subject must match the question")
  if (!isRecord(raw.data)) invalid("data must be an object")

  switch (`${subject}/${tool}`) {
    case "chinese/scoring_points":
      if (!hasOnlyKeys(raw.data, ["points", "answer"])) invalid("scoring_points contains an unknown field")
      if (!stringList(raw.data.points) || raw.data.points.filter(isFilled).length === 0 || !isFilled(raw.data.answer)) {
        invalid("scoring_points requires points and answer")
      }
      return { version: 1, subject: "chinese", tool: "scoring_points", data: raw.data as ScoringPointsEvidence["data"] }
    case "math/derivation":
      if (!hasOnlyKeys(raw.data, ["lines"])) invalid("derivation contains an unknown field")
      if (!stringList(raw.data.lines) || raw.data.lines.filter(isFilled).length < 2) {
        invalid("derivation requires at least two lines")
      }
      return { version: 1, subject: "math", tool: "derivation", data: raw.data as DerivationEvidence["data"] }
    case "english/long_sentence":
      if (!hasOnlyKeys(raw.data, ["sentence"])) invalid("long_sentence contains an unknown field")
      if (!isFilled(raw.data.sentence)) invalid("long_sentence requires a sentence")
      return { version: 1, subject: "english", tool: "long_sentence", data: raw.data as LongSentenceEvidence["data"] }
    case "physics/free_body": {
      const forces = raw.data.forces
      if (!hasOnlyKeys(raw.data, ["forces"])) invalid("free_body contains an unknown field")
      if (!Array.isArray(forces) || forces.length === 0) invalid("free_body requires at least one force")
      if (!forces.every((force) => {
        if (!isRecord(force)) return false
        if (!hasOnlyKeys(force, ["id", "name", "magnitude", "angle", "kind"])) return false
        return isFilled(force.id)
          && isFilled(force.name)
          && isFiniteNumber(force.magnitude)
          && force.magnitude >= 0
          && isFiniteNumber(force.angle)
          && (force.kind === "contact" || force.kind === "field")
      })) invalid("free_body contains an invalid force")
      return { version: 1, subject: "physics", tool: "free_body", data: raw.data as FreeBodyEvidence["data"] }
    }
    case "physics/motion": {
      const stages = raw.data.stages
      if (!hasOnlyKeys(raw.data, ["stages"])) invalid("motion contains an unknown field")
      if (!Array.isArray(stages) || stages.length === 0) invalid("motion requires at least one stage")
      const quantities: MotionQuantity[] = ["v0", "v", "a", "t", "x"]
      if (!stages.every((stage) => {
        if (!isRecord(stage) || !isFilled(stage.id) || !isFilled(stage.name)) return false
        if (!hasOnlyKeys(stage, ["id", "name", ...quantities, "derived"])) return false
        for (const key of quantities) {
          if (stage[key] !== undefined && stage[key] !== null && (!isFiniteNumber(stage[key]) || (key === "t" && (stage[key] as number) < 0))) return false
        }
        return stage.derived === undefined || stage.derived === null
          || (Array.isArray(stage.derived) && stage.derived.every((value) => quantities.includes(value as MotionQuantity)))
      })) invalid("motion contains an invalid stage")
      return { version: 1, subject: "physics", tool: "motion", data: raw.data as MotionEvidence["data"] }
    }
    case "chemistry/equation":
      if (!hasOnlyKeys(raw.data, ["equation"])) invalid("equation contains an unknown field")
      if (!isFilled(raw.data.equation)) invalid("equation requires an equation")
      return { version: 1, subject: "chemistry", tool: "equation", data: raw.data as EquationEvidence["data"] }
    case "geography/causal_chain": {
      const links = raw.data.links
      if (!hasOnlyKeys(raw.data, ["links"])) invalid("causal_chain contains an unknown field")
      if (!Array.isArray(links) || links.length === 0) invalid("causal_chain requires at least one link")
      if (!links.every((link) => isRecord(link) && hasOnlyKeys(link, ["cause", "effect"]) && isFilled(link.cause) && isFilled(link.effect))) {
        invalid("causal_chain contains an incomplete link")
      }
      return { version: 1, subject: "geography", tool: "causal_chain", data: raw.data as CausalChainEvidence["data"] }
    }
    default:
      invalid(`tool ${tool || "<empty>"} is invalid for ${subject || expectedSubject}`)
  }
}
