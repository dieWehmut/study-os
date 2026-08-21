import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { FreeBodyBoard } from "./FreeBodyBoard"

function addForce(name: string, magnitude: string, angle: string, field = false) {
  fireEvent.change(screen.getByLabelText("力的名称"), { target: { value: name } })
  fireEvent.change(screen.getByLabelText("大小（N）"), { target: { value: magnitude } })
  fireEvent.change(screen.getByLabelText("方向（度）"), { target: { value: angle } })
  fireEvent.click(screen.getByRole("button", { name: field ? "场力" : "接触力" }))
  fireEvent.click(screen.getByRole("button", { name: "加上这个力" }))
}

describe("drawing a free-body diagram", () => {
  it("restores forces and reports additions and removals", () => {
    const onChange = vi.fn()
    render(
      <FreeBodyBoard
        initialValue={{
          forces: [{ id: "gravity", name: "重力", magnitude: 10, angle: 270, kind: "field" }],
        }}
        onChange={onChange}
      />,
    )

    expect(screen.getByText("重力")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "受力图，共 1 个力" })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()

    addForce("支持力", "10", "90")
    expect(onChange).toHaveBeenLastCalledWith({
      forces: [
        { id: "gravity", name: "重力", magnitude: 10, angle: 270, kind: "field" },
        { id: "支持力-1", name: "支持力", magnitude: 10, angle: 90, kind: "contact" },
      ],
    })

    fireEvent.click(screen.getByRole("button", { name: "删掉 重力" }))
    expect(onChange).toHaveBeenLastCalledWith({
      forces: [{ id: "支持力-1", name: "支持力", magnitude: 10, angle: 90, kind: "contact" }],
    })
  })

  it("keeps every force you add, named", () => {
    render(<FreeBodyBoard />)

    addForce("重力", "10", "270", true)
    addForce("支持力", "10", "90")

    expect(screen.getByRole("img", { name: /受力图/ })).toBeInTheDocument()
    expect(screen.getByText("重力")).toBeInTheDocument()
    expect(screen.getByText("支持力")).toBeInTheDocument()
  })

  it("adds the forces as vectors and shows the answer as a number", () => {
    // 3 N 向右 and 4 N 向上 is 5 N, never 7 N. The answer is the reason to
    // draw it at all, so it is text you can read, not a line you must measure.
    render(<FreeBodyBoard />)

    addForce("重力", "4", "90", true)
    addForce("拉力", "3", "0")

    expect(screen.getByText(/5\.0 N/)).toBeInTheDocument()
    expect(screen.getByText(/53°/)).toBeInTheDocument()
  })

  it("says 平衡 instead of drawing an arrow of length zero", () => {
    render(<FreeBodyBoard />)

    addForce("重力", "10", "270", true)
    addForce("支持力", "10", "90")

    expect(screen.getByText(/平衡/)).toBeInTheDocument()
  })

  it("asks for the field force while only contact forces are drawn", () => {
    // The advice this board exists to carry out says to mark 接触面 first and
    // 场力 last -- so the moment you have stopped, it should ask.
    render(<FreeBodyBoard />)

    addForce("支持力", "10", "90")

    expect(screen.getByText(/还没有标场力/)).toBeInTheDocument()
  })

  it("takes a force back off, because a wrong one is worse than a missing one", () => {
    render(<FreeBodyBoard />)

    addForce("摩擦力", "3", "180")
    fireEvent.click(screen.getByRole("button", { name: "删掉 摩擦力" }))

    expect(screen.queryByText("摩擦力")).not.toBeInTheDocument()
  })

  it("refuses a force with no name rather than drawing an unnamed arrow", () => {
    // An arrow you cannot name is one you cannot check, and checking is the
    // entire job of the drawing.
    render(<FreeBodyBoard />)

    fireEvent.change(screen.getByLabelText("大小（N）"), { target: { value: "10" } })

    expect(screen.getByRole("button", { name: "加上这个力" })).toBeDisabled()
  })
})
