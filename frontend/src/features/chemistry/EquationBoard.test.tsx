import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { EquationBoard } from "./EquationBoard"

function write(equation: string) {
  fireEvent.change(screen.getByLabelText("化学方程式"), { target: { value: equation } })
}

describe("checking an equation you have just written", () => {
  it("says so when both sides add up", () => {
    render(<EquationBoard />)

    write("2H2 + O2 = 2H2O")

    expect(screen.getByText("配平了")).toBeInTheDocument()
  })

  it("names the element that does not add up, with both totals", () => {
    // "回查一遍" is only actionable if it says which element and by how much.
    // "没配平" alone sends you back to count all of them again.
    render(<EquationBoard />)

    write("H2 + O2 = H2O")

    expect(screen.getByRole("alert")).toHaveTextContent("O：左 2，右 1")
    expect(screen.queryByText("配平了")).not.toBeInTheDocument()
  })

  it("sets the formulas the way they are printed", () => {
    // Reading back 2H2O as plain text is how a coefficient and a subscript get
    // confused in the first place, which is the slip being checked for.
    render(<EquationBoard />)

    write("2H2 + O2 = 2H2O")

    expect(screen.getByLabelText("2H2O").querySelector("sub")?.textContent).toBe("2")
  })

  it("keeps a state symbol beside the formula, not inside it", () => {
    render(<EquationBoard />)

    write("H2O(l) = H2O(g)")

    expect(screen.getByText("(g)")).toBeInTheDocument()
  })

  it("says which formulas were left without a state symbol", () => {
    render(<EquationBoard />)

    write("CaCO3 = CaO + CO2(g)")

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("CaCO3")
    expect(alert).toHaveTextContent("CaO")
  })

  it("stays quiet about states when the equation never uses them", () => {
    render(<EquationBoard />)

    write("CaCO3 = CaO + CO2")

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows what it could not read instead of a verdict", () => {
    render(<EquationBoard />)

    write("Xy + O2 = XyO2")

    expect(screen.getByRole("alert")).toHaveTextContent("Xy")
    expect(screen.queryByText("配平了")).not.toBeInTheDocument()
  })

  it("says nothing at all until you have written something", () => {
    // "还没有写方程式" is true of an empty box and useless to be told.
    render(<EquationBoard />)

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText("配平了")).not.toBeInTheDocument()
  })
})
