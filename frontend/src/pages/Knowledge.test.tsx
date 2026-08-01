import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Knowledge from "./Knowledge"

const mocks = vi.hoisted(() => ({
  getKnowledge: vi.fn(),
  listKnowledge: vi.fn(),
}))

vi.mock("@/api/knowledge", () => mocks)

describe("Knowledge page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [
        {
          id: "k1",
          item_type: "word_sense",
          term: "abandon",
          part_of_speech: "v",
          concise_definition: "放弃；抛弃",
          detailed_markdown: "## Usage\n\nTo leave something behind.",
          tags: ["core"],
        },
      ],
    })
    mocks.getKnowledge.mockResolvedValue({
      id: "k1",
      item_type: "word_sense",
      term: "abandon",
      part_of_speech: "v",
      concise_definition: "放弃；抛弃",
      detailed_markdown: "## Usage\n\nTo leave something behind.",
      tags: ["core"],
    })
  })

  it("renders a selected item in concise and detail tabs", async () => {
    render(<Knowledge />)

    expect(await screen.findByRole("heading", { name: "abandon" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "简明" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "详细 Wiki" }))

    expect(await screen.findByText("To leave something behind.")).toBeInTheDocument()
  })

  it("does not render raw HTML or unsafe Markdown links", async () => {
    mocks.listKnowledge.mockResolvedValueOnce({
      count: 1,
      items: [{
        id: "k1",
        item_type: "word_sense",
        term: "safe",
        concise_definition: "安全",
        detailed_markdown: '<script>alert("x")</script>\n\n[bad](javascript:alert(1))',
      }],
    })
    const { container } = render(<Knowledge />)

    fireEvent.click(await screen.findByRole("tab", { name: "详细 Wiki" }))
    expect(container.querySelector("script")).toBeNull()
    expect(screen.getByText("bad")).toBeInTheDocument()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it("searches the server and reports an empty result", async () => {
    mocks.listKnowledge.mockImplementation(({ query }: { query?: string }) =>
      Promise.resolve(query ? { count: 0, items: [] } : {
        count: 1,
        items: [{
          id: "k1",
          item_type: "word_sense",
          term: "abandon",
          concise_definition: "放弃；抛弃",
        }],
      }),
    )
    render(<Knowledge />)

    const search = screen.getByRole("searchbox", { name: "搜索知识库" })
    fireEvent.change(search, { target: { value: "missing" } })

    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenCalledWith({ query: "missing", limit: 100, offset: 0 }))
    expect(await screen.findByText("没有找到匹配的知识点")).toBeInTheDocument()
  })
})
