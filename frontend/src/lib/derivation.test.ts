import { describe, expect, it } from "vitest"

import { checkDerivation } from "./derivation"

function verdicts(lines: string[]): string[] {
  return checkDerivation(lines).steps.map((step) => step.verdict)
}

describe("checking a derivation line against line", () => {
  it("lets a step that only rewrites the line through", () => {
    const checked = checkDerivation(["2(x+1)", "2x+2"])

    expect(checked.divergedAt).toBeNull()
    expect(verdicts(["2(x+1)", "2x+2"])).toEqual(["start", "follows"])
  })

  it("names the first line that does not follow from the one above", () => {
    const checked = checkDerivation(["2(x+1)", "2x+2", "2x+3"])

    expect(checked.divergedAt).toBe(2)
    expect(checked.steps[2]?.note).not.toBeNull()
  })

  it("does not accuse the lines after the one that broke", () => {
    // Everything below a wrong step is downstream of it. Marking those wrong
    // too is the 整题重做 the advice exists to prevent.
    const checked = checkDerivation(["2(x+1)", "2x+3", "2x+3", "2x+3"])

    expect(checked.divergedAt).toBe(1)
    expect(checked.steps.map((step) => step.verdict)).toEqual([
      "start",
      "diverges",
      "unchecked",
      "unchecked",
    ])
  })

  it("catches the sign slip that survives to the answer line", () => {
    expect(checkDerivation(["-(x-3)", "-x-3"]).divergedAt).toBe(1)
    expect(checkDerivation(["-(x-3)", "-x+3"]).divergedAt).toBeNull()
  })

  it("reads 2x as two times x, the way it is written", () => {
    expect(checkDerivation(["2x", "x+x"]).divergedAt).toBeNull()
    expect(checkDerivation(["x(y+1)", "xy+x"]).divergedAt).toBeNull()
  })

  it("lets both sides of an equation be divided through", () => {
    // 2x = 6 and x = 3 are the same equation and different expressions. The
    // equals sign you wrote is the instruction for how to check the line.
    expect(checkDerivation(["2x+4=10", "2x=6", "x=3"]).divergedAt).toBeNull()
  })

  it("will not let the same rewrite pass without the equals sign", () => {
    expect(checkDerivation(["2x+6", "x+3"]).divergedAt).toBe(1)
  })

  it("still catches a wrong step inside an equation", () => {
    expect(checkDerivation(["2x+4=10", "2x=14"]).divergedAt).toBe(1)
  })

  it("says which line it could not read, rather than calling it wrong", () => {
    // A half-typed line is not a mistake in the derivation, and reporting it as
    // one would point at the wrong thing.
    const checked = checkDerivation(["2x+", "x"])

    expect(checked.divergedAt).toBeNull()
    expect(checked.steps[0]?.verdict).toBe("unreadable")
    expect(checked.steps[1]?.verdict).toBe("unchecked")
  })

  it("works through a root and a power", () => {
    expect(checkDerivation(["sqrt(x)*sqrt(x)", "x"]).divergedAt).toBeNull()
    expect(checkDerivation(["(x+1)^2", "x^2+2x+1"]).divergedAt).toBeNull()
    expect(checkDerivation(["(x+1)^2", "x^2+1"]).divergedAt).toBe(1)
  })

  it("takes a solved root as following from the equation it solves", () => {
    // Factoring down to a root is not an equivalence -- x = 2 drops the x = 3
    // branch -- but it is a correct step, and the commonest one in 高中 算式.
    // A check that flagged it would cry wrong on every quadratic.
    expect(checkDerivation(["x^2-5x+6=0", "(x-2)(x-3)=0", "x=2"]).divergedAt).toBeNull()
  })

  it("rejects a root that does not satisfy the line above", () => {
    expect(checkDerivation(["x^2-5x+6=0", "x=4"]).divergedAt).toBe(1)
  })

  it("has nothing to say about a single line, or none", () => {
    expect(checkDerivation(["x+1"]).divergedAt).toBeNull()
    expect(verdicts(["x+1"])).toEqual(["start"])
    expect(checkDerivation([]).steps).toEqual([])
  })
})
