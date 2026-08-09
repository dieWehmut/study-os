import { describe, expect, it } from "vitest"

import { checkEquation } from "./equation"

describe("reading a chemical equation as written", () => {
  it("counts the atoms on each side", () => {
    const checked = checkEquation("2H2 + O2 = 2H2O")

    expect(checked.error).toBeNull()
    expect(checked.left[0]?.atoms).toEqual({ H: 4 })
    expect(checked.right[0]?.atoms).toEqual({ H: 4, O: 2 })
    expect(checked.balanced).toBe(true)
  })

  it("distributes a bracket's multiplier over everything inside it", () => {
    // Ca(OH)2 is two oxygens and two hydrogens, and getting this wrong is the
    // 配平 slip that survives to the answer line.
    const checked = checkEquation("Ca(OH)2 = CaO + H2O")

    expect(checked.left[0]?.atoms).toEqual({ Ca: 1, O: 2, H: 2 })
    expect(checked.balanced).toBe(true)
  })

  it("handles a bracket inside a bracket", () => {
    const checked = checkEquation("K4[Fe(CN)6] = K4[Fe(CN)6]")

    expect(checked.left[0]?.atoms).toEqual({ K: 4, Fe: 1, C: 6, N: 6 })
  })

  it("names every element that does not add up, not just the first", () => {
    // Stopping at the first difference hides the second, and the second is
    // usually the one you would not have found yourself.
    const checked = checkEquation("H2 + O2 = H2O")

    expect(checked.balanced).toBe(false)
    expect(checked.differences).toEqual([{ element: "O", left: 2, right: 1 }])
  })

  it("reads → and ⇌ as the arrow they are", () => {
    expect(checkEquation("2H2 + O2 → 2H2O").balanced).toBe(true)
    expect(checkEquation("N2 + 3H2 ⇌ 2NH3").balanced).toBe(true)
  })

  it("keeps the state symbol off the formula and out of the atom count", () => {
    const checked = checkEquation("H2O(l) = H2O(g)")

    expect(checked.left[0]?.formula).toBe("H2O")
    expect(checked.left[0]?.state).toBe("l")
    expect(checked.left[0]?.atoms).toEqual({ H: 2, O: 1 })
  })

  it("says which formulas were left without a state, once any has one", () => {
    // 状态符号 is all-or-nothing in a marked answer. Naming them only when
    // some are present is what keeps the check off an equation written in the
    // style that does not use them at all.
    const checked = checkEquation("CaCO3 = CaO + CO2(g)")

    expect(checked.missingStates).toEqual(["CaCO3", "CaO"])
  })

  it("says nothing about states when the equation never uses them", () => {
    expect(checkEquation("CaCO3 = CaO + CO2").missingStates).toEqual([])
  })

  it("refuses a symbol that is not an element rather than counting it", () => {
    // Xy parses fine as "one Xy" and would balance against another Xy. A
    // 配平 check that confirms a typo is worse than one that says nothing.
    const checked = checkEquation("Xy + O2 = XyO2")

    expect(checked.error).toContain("Xy")
  })

  it("asks for both sides before checking anything", () => {
    expect(checkEquation("H2 + O2").error).toContain("=")
    expect(checkEquation("").error).toContain("还没有")
  })
})
