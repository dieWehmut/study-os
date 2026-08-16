import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { MarkdownWorkspace } from "./MarkdownWorkspace"

describe("MarkdownWorkspace", () => {
  it("keeps one controlled source editor beside a live semantic preview", () => {
    const onMarkdownChange = vi.fn()
    render(<MarkdownWorkspace markdown="# Title\n\nAt last." onMarkdownChange={onMarkdownChange} />)

    fireEvent.change(screen.getByLabelText("\u539f\u6587"), { target: { value: "# Changed" } })
    expect(onMarkdownChange).toHaveBeenCalledWith("# Changed")
    expect(screen.getByRole("region", { name: "Markdown \u5b9e\u65f6\u9884\u89c8" })).toHaveTextContent("At last.")
    expect(screen.getByTestId("markdown-workspace")).toHaveClass("lg:grid-cols-2")
  })

  it("opens a vocabulary popover from the preview without replacing the source", async () => {
    render(<MarkdownWorkspace markdown="A complicated man." onMarkdownChange={vi.fn()} />)
    const termButton = await screen.findByRole("button", { name: "\u67e5\u8bcd complicated" })
    fireEvent.click(termButton)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "\u67e5\u8bcd complicated" })).toBe(termButton)
    expect(screen.getByLabelText("\u539f\u6587")).toHaveValue("A complicated man.")
  })
})
