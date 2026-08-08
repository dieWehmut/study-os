import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import Practice from "./Practice"

function log(question: string, cause: string) {
  fireEvent.change(screen.getByLabelText("错题"), { target: { value: question } })
  fireEvent.click(screen.getByRole("button", { name: cause }))
}

describe("Practice page", () => {
  it("says plainly that nothing has gone wrong yet", () => {
    render(<Practice />)

    expect(screen.getByText(/还没有记录/)).toBeInTheDocument()
  })

  it("files a mistake under the cause you picked", () => {
    render(<Practice />)
    log("光合作用第 3 问", "看错题")

    expect(screen.getByText("光合作用第 3 问")).toBeInTheDocument()
    expect(screen.getAllByText("看错题").length).toBeGreaterThan(1)
  })

  it("takes the cause click as the whole record, not a step before saving", () => {
    // Type, pick, done. A separate 保存 button is a third action at the moment
    // you least want one -- right after getting something wrong.
    render(<Practice />)
    log("速度与加速度", "想不起来")

    expect(screen.getByLabelText("错题")).toHaveValue("")
  })

  it("has nothing to file while the box is empty", () => {
    render(<Practice />)

    expect(screen.getByRole("button", { name: "想不起来" })).toBeDisabled()
  })

  it("says how much of the log review can actually fix", () => {
    // The rest of the app answers every wrong answer with "see it again
    // sooner". This is the number that says when that answer is wrong.
    render(<Practice />)
    log("第 1 题", "想不起来")
    log("第 2 题", "看错题")
    log("第 3 题", "算错 / 手滑")

    expect(screen.getByText("复习能解决 1")).toBeInTheDocument()
    expect(screen.getByText("另有原因 2")).toBeInTheDocument()
  })

  it("says what to do about a cause review will not fix", () => {
    render(<Practice />)
    log("第 1 题", "看错题")

    expect(screen.getByText(/圈出条件/)).toBeInTheDocument()
  })

  it("lets you take back a row you filed wrong", () => {
    render(<Practice />)
    log("第 1 题", "看错题")

    fireEvent.click(screen.getByRole("button", { name: /删除/ }))

    expect(screen.queryByText("第 1 题")).not.toBeInTheDocument()
    expect(screen.getByText(/还没有记录/)).toBeInTheDocument()
  })

  it("puts the newest mistake on top, where you are looking", () => {
    render(<Practice />)
    log("旧的", "看错题")
    log("新的", "看错题")

    const rows = screen.getAllByRole("listitem")
    expect(rows[0].textContent).toContain("新的")
  })
})
