import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import Reading from "./Reading"

const source = ["# 光合作用", "## 光反应", "在类囊体薄膜上进行。", "## 暗反应", "在叶绿体基质中进行。"].join("\n")

function paste(markdown: string) {
  fireEvent.change(screen.getByLabelText("原文"), { target: { value: markdown } })
}

describe("Reading page", () => {
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
