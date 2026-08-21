import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { SolvedStage } from "@/lib/kinematics"

import { MotionBoard } from "./MotionBoard"

function addStage(
  name: string,
  numbers: Partial<Record<"初速度（m/s）" | "末速度（m/s）" | "加速度（m/s²）" | "时间（s）" | "位移（m）", string>>,
) {
  fireEvent.change(screen.getByLabelText("这一段叫什么"), { target: { value: name } })
  for (const [label, value] of Object.entries(numbers)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
  fireEvent.click(screen.getByRole("button", { name: "加上这一段" }))
}

describe("dividing a motion into stages", () => {
  it("restores stages and reports additions and removals", () => {
    const onChange = vi.fn()
    const saved: SolvedStage = {
      id: "accelerate",
      name: "加速",
      v0: 0,
      v: 10,
      a: 2,
      t: 5,
      x: 25,
      derived: ["v", "x"],
    }
    render(<MotionBoard initialValue={{ stages: [saved] }} onChange={onChange} />)

    expect(screen.getByRole("heading", { level: 4, name: "加速" })).toBeInTheDocument()
    expect(screen.getByText("末速度 10 m/s")).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()

    addStage("匀速", { "初速度（m/s）": "10", "加速度（m/s²）": "0", "时间（s）": "2" })
    expect(onChange).toHaveBeenLastCalledWith({
      stages: expect.arrayContaining([
        expect.objectContaining({ id: "accelerate", name: "加速" }),
        expect.objectContaining({ id: "匀速-1", name: "匀速", v0: 10, t: 2 }),
      ]),
    })

    fireEvent.click(screen.getByRole("button", { name: "删掉 加速" }))
    expect(onChange).toHaveBeenLastCalledWith({
      stages: [expect.objectContaining({ id: "匀速-1", name: "匀速" })],
    })
  })

  it("keeps every stage you add, named and in order", () => {
    render(<MotionBoard />)

    addStage("加速", { "初速度（m/s）": "0", "加速度（m/s²）": "2", "时间（s）": "5" })
    addStage("匀速", { "初速度（m/s）": "10", "加速度（m/s²）": "0", "时间（s）": "2" })

    const names = screen.getAllByRole("heading", { level: 4 }).map((node) => node.textContent)
    expect(names).toEqual(["加速", "匀速"])
  })

  it("shows the number you did not write, and says it worked it out", () => {
    // The whole point of 写出每段的初末状态: the fourth number was always
    // available, and not writing it is how a stage gets skipped.
    render(<MotionBoard />)

    addStage("加速", { "初速度（m/s）": "0", "加速度（m/s²）": "2", "时间（s）": "5" })

    expect(screen.getByText("末速度 10 m/s")).toBeInTheDocument()
    expect(screen.getByText("位移 25 m")).toBeInTheDocument()
    expect(screen.getAllByText("算出来的").length).toBeGreaterThan(0)
  })

  it("leaves the boxes it cannot fill empty rather than guessing", () => {
    // Two knowns is below the threshold. An invented number looks like an
    // answer, which is worse than a blank.
    render(<MotionBoard />)

    addStage("未知", { "初速度（m/s）": "5" })

    expect(screen.getByText("末速度 —")).toBeInTheDocument()
    expect(screen.queryByText("算出来的")).not.toBeInTheDocument()
  })

  it("says where one stage does not start where the last one ended", () => {
    // The reason to divide the process at all. A seam that jumps is a stage
    // you have not accounted for.
    render(<MotionBoard />)

    addStage("加速", { "初速度（m/s）": "0", "加速度（m/s²）": "2", "时间（s）": "5" })
    addStage("匀速", { "初速度（m/s）": "3", "加速度（m/s²）": "0", "时间（s）": "2" })

    expect(screen.getByRole("alert")).toHaveTextContent("匀速")
  })

  it("stays quiet while the stages still join up", () => {
    render(<MotionBoard />)

    addStage("加速", { "初速度（m/s）": "0", "加速度（m/s²）": "2", "时间（s）": "5" })
    addStage("匀速", { "初速度（m/s）": "10", "加速度（m/s²）": "0", "时间（s）": "2" })

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("adds up the stages so the whole motion is one line", () => {
    // 再回头看问的是哪一段 needs the total to compare a stage against.
    render(<MotionBoard />)

    addStage("加速", { "初速度（m/s）": "0", "加速度（m/s²）": "2", "时间（s）": "5" })
    addStage("匀速", { "初速度（m/s）": "10", "加速度（m/s²）": "0", "时间（s）": "2" })

    expect(screen.getByText(/全程 7 s/)).toBeInTheDocument()
    expect(screen.getByText(/45 m/)).toBeInTheDocument()
  })

  it("refuses a stage with no name, so the seams can be talked about", () => {
    render(<MotionBoard />)

    fireEvent.change(screen.getByLabelText("初速度（m/s）"), { target: { value: "1" } })

    expect(screen.getByRole("button", { name: "加上这一段" })).toBeDisabled()
  })

  it("takes a stage back off the board", () => {
    render(<MotionBoard />)

    addStage("加速", { "初速度（m/s）": "0", "加速度（m/s²）": "2", "时间（s）": "5" })
    fireEvent.click(screen.getByRole("button", { name: "删掉 加速" }))

    expect(screen.queryByRole("heading", { level: 4, name: "加速" })).not.toBeInTheDocument()
  })
})
