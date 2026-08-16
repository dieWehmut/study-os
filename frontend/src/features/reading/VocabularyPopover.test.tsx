import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { VocabularySelection } from "./MarkdownPreview"
import { VocabularyPopover } from "./VocabularyPopover"

const lookup = vi.hoisted(() => vi.fn())

vi.mock("@/api/knowledge", () => ({ lookupVocabulary: lookup }))

function selection(term: string, anchor?: HTMLElement): VocabularySelection {
  return {
    term,
    display: term,
    kind: term.includes(" ") ? "expression" : "word",
    context: `A sentence containing ${term}.`,
    anchor: anchor ?? document.body,
  }
}

function item(term: string, id = `id-${term.replaceAll(" ", "-")}`) {
  return {
    id,
    item_type: "word_wiki",
    term,
    part_of_speech: "adjective",
    pronunciation: "/test/",
    concise_definition: "\u590d\u6742\u7684\uff1b\u96be\u61c2\u7684",
    detailed_markdown: "# Wiki",
    example: `An example with ${term}.`,
    subject: "english",
    tags: ["reading-vocabulary"],
  }
}

describe("VocabularyPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    )
  })

  it("loads a definition and links to the knowledge item", async () => {
    lookup.mockResolvedValue({ source: "generated", item: item("complicated") })
    render(<VocabularyPopover selection={selection("complicated")} onClose={vi.fn()} />)

    expect(screen.getByText("\u6b63\u5728\u67e5\u8be2\u8bcd\u4e49\u2026")).toBeInTheDocument()
    expect(await screen.findByText("\u590d\u6742\u7684\uff1b\u96be\u61c2\u7684")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "\u5728\u77e5\u8bc6\u5e93\u67e5\u770b" })).toHaveAttribute(
      "href",
      "/knowledge?item=id-complicated",
    )
  })

  it("exposes retry after a failed request and retries explicitly", async () => {
    lookup.mockRejectedValueOnce(new Error("offline"))
    lookup.mockResolvedValueOnce({ source: "existing", item: item("resilient") })
    render(<VocabularyPopover selection={selection("resilient")} onClose={vi.fn()} />)

    expect(await screen.findByRole("alert")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "\u91cd\u8bd5" }))
    expect(await screen.findByText("\u590d\u6742\u7684\uff1b\u96be\u61c2\u7684")).toBeInTheDocument()
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it("caches a resolved term for the lifetime of the page", async () => {
    lookup.mockResolvedValue({ source: "existing", item: item("cached") })
    const view = render(<VocabularyPopover selection={selection("cached")} onClose={vi.fn()} />)
    await screen.findByText("\u590d\u6742\u7684\uff1b\u96be\u61c2\u7684")
    view.rerender(<VocabularyPopover selection={selection("cached")} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("\u590d\u6742\u7684\uff1b\u96be\u61c2\u7684")).toBeInTheDocument())
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it("ignores a late response for a previous selection", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    lookup.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    lookup.mockResolvedValueOnce({ source: "existing", item: item("new-term", "id-new") })
    const view = render(<VocabularyPopover selection={selection("old-term")} onClose={vi.fn()} />)
    view.rerender(<VocabularyPopover selection={selection("new-term")} onClose={vi.fn()} />)
    expect(await screen.findByText("\u590d\u6742\u7684\uff1b\u96be\u61c2\u7684")).toBeInTheDocument()
    resolveFirst?.({ source: "existing", item: item("old-term", "id-old") })
    await waitFor(() => expect(screen.getByRole("link", { name: "\u5728\u77e5\u8bc6\u5e93\u67e5\u770b" })).toHaveAttribute("href", "/knowledge?item=id-new"))
    expect(screen.queryByText("id-old")).not.toBeInTheDocument()
  })

  it("closes on Escape and uses the dialog sheet on narrow screens", async () => {
    const onClose = vi.fn()
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    )
    lookup.mockResolvedValue({ source: "existing", item: item("mobile") })
    render(<VocabularyPopover selection={selection("mobile")} onClose={onClose} />)
    await screen.findByText("\u590d\u6742\u7684\uff1b\u96be\u61c2\u7684")
    const dialog = screen.getByRole("dialog")
    expect(dialog.className).toContain("bottom-0")
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })
})
