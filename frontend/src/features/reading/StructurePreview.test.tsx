import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { chunkMarkdown } from "@/lib/chunk"
import { StructurePreview } from "./StructurePreview"

const source = [
  "# 光合作用",
  "## 光反应",
  "在类囊体薄膜上进行。产物是 ATP 和 NADPH。",
  "## 暗反应",
  "在叶绿体基质中进行。",
  "### 固定",
  "CO2 与 C5 结合。",
].join("\n")

describe("structure preview", () => {
  it("shows the skeleton before any prose is read", () => {
    render(<StructurePreview markdown={source} />)

    expect(screen.getByRole("button", { name: /光反应/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /暗反应/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /固定/ })).toBeInTheDocument()
  })

  it("counts the stops so the length is known before starting", () => {
    render(<StructurePreview markdown={source} />)

    expect(screen.getByText("3 个小节")).toBeInTheDocument()
  })

  it("previews each stop with its first sentence", () => {
    render(<StructurePreview markdown={source} />)

    expect(screen.getByText("在类囊体薄膜上进行。")).toBeInTheDocument()
  })

  it("nests a stop under its parent so the shape is visible", () => {
    render(<StructurePreview markdown={source} />)

    // 固定 sits under 暗反应, two levels below the document title, so it is
    // indented one step further than its parent. The indent is the structure.
    const nested = screen.getByRole("button", { name: /固定/ })
    const parent = screen.getByRole("button", { name: /暗反应/ })
    expect(Number(nested.dataset.depth)).toBeGreaterThan(Number(parent.dataset.depth))
  })

  it("hands the chosen stop to the reader", () => {
    const onSelect = vi.fn()
    render(<StructurePreview markdown={source} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole("button", { name: /暗反应/ }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].title).toBe("暗反应")
  })

  it("marks the stop currently open in the reader", () => {
    // Derive the id rather than hard-coding it: the preview's job is to point
    // at the same chunk the reader opened, not to agree on an id format.
    const [, second] = chunkMarkdown(source)
    render(<StructurePreview markdown={source} activeId={second.id} />)

    const current = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "true")
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain("暗反应")
  })

  it("says so plainly when there is nothing to preview yet", () => {
    render(<StructurePreview markdown="   " />)

    expect(screen.getByText(/粘贴/)).toBeInTheDocument()
    expect(screen.queryAllByRole("button")).toHaveLength(0)
  })

  it("shows how heavy each stop is, so a long one is not a surprise", () => {
    render(<StructurePreview markdown={source} />)

    // 暗反应 holds "在叶绿体基质中进行。" and nothing else.
    expect(screen.getByText("10 字")).toBeInTheDocument()
  })
})
