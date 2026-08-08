import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import Reading from "./Reading"

const source = ["# 光合作用", "## 光反应", "在类囊体薄膜上进行。", "## 暗反应", "在叶绿体基质中进行。"].join("\n")

function paste(markdown: string) {
  fireEvent.change(screen.getByLabelText("原文"), { target: { value: markdown } })
}

describe("Reading page", () => {
  it("moves you on once a stop is done, so the mark doubles as a page turn", () => {
    // Marking and then reaching for 下一节 is two actions for one intent.
    render(<Reading />)
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))

    expect(screen.getByText("2 / 2")).toBeInTheDocument()
  })

  it("remembers a stop was finished after you walk back to it", () => {
    render(<Reading />)
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))
    fireEvent.click(screen.getByRole("button", { name: /上一节/ }))

    expect(screen.getByRole("button", { name: /已读完/ })).toBeInTheDocument()
  })

  it("lets you take a mark back", () => {
    // Marking the wrong stop is easy; a record you cannot correct stops being
    // a record of what you read.
    render(<Reading />)
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))
    fireEvent.click(screen.getByRole("button", { name: /上一节/ }))
    fireEvent.click(screen.getByRole("button", { name: /已读完/ }))

    expect(screen.getByRole("button", { name: /读完/ })).toHaveAttribute("aria-pressed", "false")
  })

  it("stays on the last stop rather than pretending there is another one", () => {
    render(<Reading />)
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))
    fireEvent.click(screen.getByRole("button", { name: /读完/ }))

    expect(screen.getByText("2 / 2")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /已读完/ })).toBeInTheDocument()
  })

  it("carries the marks into the outline, where the whole document is visible", () => {
    // The reader only ever shows one stop, so it can say "this one is done"
    // but never "you are two of three through". The outline is where that
    // question is answerable.
    render(<Reading />)
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))

    expect(screen.getByText("已读 1 / 2")).toBeInTheDocument()
  })

  it("shows the document's stops once something is pasted", () => {
    render(<Reading />)
    paste(source)

    expect(screen.getByRole("button", { name: /光反应/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /暗反应/ })).toBeInTheDocument()
  })

  it("keeps the map folded away until it is asked for", () => {
    // The outline, the prose and a full map on screen at once is the same wall
    // of information the preview exists to avoid.
    render(<Reading />)
    paste(source)

    expect(screen.queryByRole("tree")).not.toBeInTheDocument()
  })

  it("draws the map from the text already pasted, with no second paste box", () => {
    render(<Reading />)
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /看导图/ }))

    expect(screen.getByRole("tree", { name: "导图：光合作用" })).toBeInTheDocument()
    expect(screen.getByRole("treeitem", { name: "暗反应" })).toBeInTheDocument()
    expect(screen.getAllByLabelText("原文")).toHaveLength(1)
  })

  it("puts the map away again", () => {
    render(<Reading />)
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /看导图/ }))
    fireEvent.click(screen.getByRole("button", { name: /收起导图/ }))

    expect(screen.queryByRole("tree")).not.toBeInTheDocument()
  })

  it("has no map to offer before anything is pasted", () => {
    render(<Reading />)

    expect(screen.queryByRole("button", { name: /看导图/ })).not.toBeInTheDocument()
  })
})
