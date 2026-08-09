import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ScoringBoard } from "./ScoringBoard"

function listPoints(text: string) {
  fireEvent.change(screen.getByLabelText("标准答案的得分点"), { target: { value: text } })
}

function answer(text: string) {
  fireEvent.change(screen.getByLabelText("你写的答案"), { target: { value: text } })
}

describe("laying an answer against the 得分点", () => {
  it("counts how many points the answer reached", () => {
    render(<ScoringBoard />)

    listPoints("借景抒情\n对比手法\n思乡之情")
    answer("这两句借景抒情，写出了思乡之情。")

    expect(screen.getByText("踩到 2 / 3 个点")).toBeInTheDocument()
  })

  it("names the point that is missing, since that is the one to go fix", () => {
    render(<ScoringBoard />)

    listPoints("借景抒情\n对比手法")
    answer("这两句借景抒情。")

    expect(screen.getByRole("alert")).toHaveTextContent("对比手法")
  })

  it("does not list a point the answer reached as missing", () => {
    render(<ScoringBoard />)

    listPoints("借景抒情\n对比手法")
    answer("这两句借景抒情。")

    expect(screen.getByRole("alert")).not.toHaveTextContent("借景抒情")
  })

  it("shows the wording that scored the point, not just a tick", () => {
    // 踩到了 with nothing shown is a claim you cannot check. The snippet is
    // what lets you disagree with the board.
    render(<ScoringBoard />)

    listPoints("借景抒情")
    answer("作者借助景物抒发情感。")

    expect(screen.getByText("借助景物抒发情")).toBeInTheDocument()
  })

  it("says so when every point was reached", () => {
    render(<ScoringBoard />)

    listPoints("借景抒情")
    answer("这两句借景抒情。")

    expect(screen.getByText("每个点都踩到了")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps a blank line between two points from counting as a point", () => {
    render(<ScoringBoard />)

    listPoints("借景抒情\n\n对比手法\n")
    answer("这两句借景抒情，也有对比手法。")

    expect(screen.getByText("踩到 2 / 2 个点")).toBeInTheDocument()
  })

  it("says nothing before the 得分点 are listed", () => {
    // An answer with nothing to check it against is not 0 分, and saying so
    // would be scoring work you have not asked it to score.
    render(<ScoringBoard />)

    answer("这两句借景抒情。")

    expect(screen.queryByText(/踩到/)).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("waits for the answer before calling every point missing", () => {
    render(<ScoringBoard />)

    listPoints("借景抒情\n对比手法")

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
