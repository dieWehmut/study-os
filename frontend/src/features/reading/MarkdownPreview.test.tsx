import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { MarkdownPreview } from "./MarkdownPreview"

const entries = [
  { normalized: "at last", display: "at last", kind: "expression" as const },
  { normalized: "complicated", display: "complicated", kind: "word" as const },
]

describe("MarkdownPreview", () => {
  it("renders GFM tables and vocabulary buttons with context", () => {
    const onSelect = vi.fn()
    render(
      <MarkdownPreview
        entries={entries}
        markdown={'# Title\n\n| word | meaning |\n| --- | --- |\n| complicated | complex |\n\nAt last, a complicated man.'}
        onVocabularySelect={onSelect}
      />,
    )
    const table = screen.getByRole("table")
    expect(table).toBeInTheDocument()
    expect(table.parentElement).toHaveClass("max-w-full", "overflow-x-auto")
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toHaveClass("text-2xl")
    const button = screen.getAllByRole("button", { name: "\u67e5\u8bcd complicated" }).at(-1)
    expect(button).toBeDefined()
    expect(button).toHaveClass("underline")
    fireEvent.click(button!)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      term: "complicated",
      context: expect.stringContaining("complicated man"),
    }))
  })

  it("keeps code and arbitrary HTML inert and marks callouts/line numbers", () => {
    render(
      <MarkdownPreview
        entries={entries}
        markdown={'> [!abstract] Read this\n\n`complicated`\n\n⟦ODY_LN:10⟧At last\n\n<script>alert(1)</script>'}
        onVocabularySelect={vi.fn()}
      />,
    )
    expect(document.querySelector('[data-callout="abstract"]')).toBeInTheDocument()
    expect(document.querySelector(".ody-ln")?.textContent).toBe("10")
    expect(screen.queryByRole("button", { name: "\u67e5\u8bcd complicated" })).not.toBeInTheDocument()
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument()
  })
})
