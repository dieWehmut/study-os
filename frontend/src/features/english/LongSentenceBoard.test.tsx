import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LongSentenceBoard } from "./LongSentenceBoard"

function type(sentence: string) {
  fireEvent.change(screen.getByLabelText("这句长难句"), { target: { value: sentence } })
}

describe("taking a 长难句 apart to find its 主谓", () => {
  it("puts the main clause up on its own, with a hole where the rest stood", () => {
    // This is the whole point. 先找主谓 fails on a long sentence because
    // everything hanging off the subject sits between it and its verb -- so
    // lifting that out is what puts the two back within one glance.
    render(<LongSentenceBoard />)

    type("The book that I bought yesterday is on the table.")

    expect(screen.getByText("The book … is on the table.")).toBeInTheDocument()
  })

  it("names each clause it lifted, and the word that introduced it", () => {
    render(<LongSentenceBoard />)

    type("The book that I bought yesterday is on the table.")

    const lifted = screen.getByText("that I bought yesterday").closest("li")
    expect(lifted).toHaveTextContent("定语从句")
    // Not just "that" -- the marker is the clause's own first word, so asserting
    // it alone would pass on the text and check nothing. What is worth showing,
    // and worth checking, is that the board names it as the word doing the work.
    expect(lifted).toHaveTextContent("由 that 引导")
  })

  it("counts the 分句 so you can see how deep the sentence actually goes", () => {
    render(<LongSentenceBoard />)

    type("Although he was tired, he finished the work.")

    // 分句, not 从句: this sentence carries one 从句 and one 主句. Calling the
    // total 从句 would be teaching the wrong word on a page about grammar.
    expect(screen.getByText("拆成 2 个分句")).toBeInTheDocument()
  })

  it("tells an adverbial clause from a relative one", () => {
    render(<LongSentenceBoard />)

    type("Although he was tired, he finished the work.")

    expect(screen.getByText("Although he was tired").closest("li")).toHaveTextContent("状语从句")
  })

  it("says nothing about a sentence that was never hard", () => {
    // A plain sentence dressed up as a 长难句 teaches you to distrust the board.
    // 主谓 are already adjacent here; there is nothing to lift.
    render(<LongSentenceBoard />)

    type("The book is on the table.")

    expect(screen.queryByText(/拆成 \d+ 个分句/)).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("这句不是长难句")
  })

  it("says nothing at all about an empty board", () => {
    render(<LongSentenceBoard />)

    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })
})
