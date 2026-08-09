import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DerivationBoard } from "./DerivationBoard"

function write(lines: string[]) {
  fireEvent.change(screen.getByLabelText("把过程一行一行写下来"), {
    target: { value: lines.join("\n") },
  })
}

describe("locating the step a derivation went wrong at", () => {
  it("points at the first line that does not follow", () => {
    render(<DerivationBoard />)

    write(["2x+4=10", "2x=6", "x=4"])

    expect(screen.getByRole("alert")).toHaveTextContent("第 3 行")
  })

  it("says so when every line follows from the one above", () => {
    render(<DerivationBoard />)

    write(["2x+4=10", "2x=6", "x=3"])

    expect(screen.getByText("每一步都对得上")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("marks the lines it did not check, rather than passing them", () => {
    // Everything below the break is downstream of it. Green ticks under a
    // wrong step would send you back to re-read the whole thing.
    render(<DerivationBoard />)

    write(["2x+4=10", "2x=7", "x=3.5"])

    expect(screen.getByText("没往下看")).toBeInTheDocument()
  })

  it("keeps a blank line from counting as a step", () => {
    // A blank line between two steps is spacing, not an unreadable step, and
    // numbering it would put the reported line number one off.
    render(<DerivationBoard />)

    write(["2x+4=10", "", "2x=6", "", "x=4"])

    expect(screen.getByRole("alert")).toHaveTextContent("第 3 行")
  })

  it("says which line it could not read instead of calling it wrong", () => {
    render(<DerivationBoard />)

    write(["2x+", "x=1"])

    expect(screen.getByRole("alert")).toHaveTextContent("第 1 行")
    expect(screen.queryByText("每一步都对得上")).not.toBeInTheDocument()
  })

  it("waits for a second line before saying anything", () => {
    // One line is not a derivation, and "对得上" said of it is a green tick
    // for nothing.
    render(<DerivationBoard />)

    write(["2x+4=10"])

    expect(screen.queryByText("每一步都对得上")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("says nothing at all about an empty box", () => {
    render(<DerivationBoard />)

    expect(screen.queryByText("每一步都对得上")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
