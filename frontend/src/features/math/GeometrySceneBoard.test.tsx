import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { defaultTriangleScene } from "@/lib/geometry-scene"

import { GeometrySceneBoard } from "./GeometrySceneBoard"

describe("GeometrySceneBoard", () => {
  it("shows the declarative triangle and moves its draggable vertex", () => {
    render(<GeometrySceneBoard scene={defaultTriangleScene} />)

    const board = screen.getByTestId("geometry-scene-board")
    expect(board.querySelector("svg")).toBeInTheDocument()
    expect(screen.getByTestId("geometry-segment-AB")).toHaveAttribute("x1", "58")
    expect(screen.getByTestId("geometry-segment-AB")).toHaveAttribute("y1", "176")
    expect(screen.getByTestId("geometry-segment-AB")).toHaveAttribute("x2", "262")
    expect(screen.getByTestId("geometry-segment-AB")).toHaveAttribute("y2", "176")
    expect(screen.getByTestId("geometry-segment-AB")).not.toHaveAttribute("points")
    expect(screen.getByText("已知 ∠C")).toBeInTheDocument()

    const slider = screen.getByRole("slider", { name: "顶点 C 高度" })
    fireEvent.change(slider, { target: { value: "90" } })
    expect(slider).toHaveValue("90")
    expect(screen.getByText(/三角形高度：90/)).toBeInTheDocument()
  })

  it("resets the changed point and reports an invalid scene without drawing it", () => {
    const { rerender } = render(<GeometrySceneBoard scene={defaultTriangleScene} />)
    const slider = screen.getByRole("slider", { name: "顶点 C 高度" })
    fireEvent.change(slider, { target: { value: "100" } })
    fireEvent.click(screen.getByRole("button", { name: "恢复初始图形" }))
    expect(slider).toHaveValue("134")

    rerender(<GeometrySceneBoard scene={{ ...defaultTriangleScene, points: [] }} />)
    expect(screen.queryByTestId("geometry-scene-svg")).not.toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("线段 AB 引用了不存在的点")
  })
})
