import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Formula } from "./Formula"

describe("setting a chemical formula", () => {
  it("puts the digits after an element below the line", () => {
    render(<Formula value="H2O" />)

    expect(screen.getByText("2").tagName).toBe("SUB")
  })

  it("leaves a coefficient on the line where it belongs", () => {
    // 2H2O is two molecules, H₂O each. Subscripting the leading 2 would say
    // something else entirely.
    render(<Formula value="2H2O" />)

    const subs = screen.getAllByText("2").map((node) => node.tagName)
    expect(subs).toEqual(["SUB"])
  })

  it("raises the charge on an ion instead of dropping it", () => {
    render(<Formula value="SO4^2-" />)

    expect(screen.getByText("2-").tagName).toBe("SUP")
  })

  it("keeps a state symbol on the line, unstyled", () => {
    // Only the 2 leaves the line. (g) is not part of the formula's arithmetic
    // and a subscripted one would read as an atom count.
    render(<Formula value="CO2(g)" />)

    const raised = [...screen.getByLabelText("CO2(g)").querySelectorAll("sub, sup")]
    expect(raised.map((node) => node.textContent)).toEqual(["2"])
  })

  it("reads out as the plain formula for anyone not looking at it", () => {
    // A screen reader hitting H<sub>2</sub>O says "H two O" only if the
    // element is labelled; without it the subscript is read as a separate run.
    render(<Formula value="H2O" />)

    expect(screen.getByLabelText("H2O")).toBeInTheDocument()
  })
})
