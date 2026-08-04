import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Knowledge from "./Knowledge"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  getKnowledge: vi.fn(),
  listKnowledge: vi.fn(),
  listGroups: vi.fn(),
  compareKnowledge: vi.fn(),
}))

vi.mock("@/api/knowledge", () => mocks)
vi.mock("@/api/chat", () => ({ compareKnowledge: mocks.compareKnowledge }))

describe("Knowledge page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
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
    mocks.listGroups.mockResolvedValue({
      count: 1,
      items: [{ id: "g1", name: "abandon 词族", kind: "word_family" }],
    })
    mocks.compareKnowledge.mockResolvedValue({
      summary: "速度与加速度的对比",
      same_points: ["都是运动学概念"],
      diff_points: ["速度描述快慢", "加速度描述变化快慢"],
      confusion_point: "方向",
      memory_tip: "抓差异",
    })
  })

  it("renders a selected item in concise and detail tabs", async () => {
    render(<Knowledge />)

    expect(await screen.findByRole("heading", { name: "abandon" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "简明" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "详细百科" }))

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

    fireEvent.click(await screen.findByRole("tab", { name: "详细百科" }))
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

  it("exposes the knowledge list with list semantics", async () => {
    const { container } = render(<Knowledge />)

    const list = await screen.findByRole("list", { name: "知识点列表" })
    expect(list).toBeInTheDocument()
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1)
  })

  it("ignores a stale detail response after switching items", async () => {
    const items = [
      {
        id: "k1",
        item_type: "word_sense",
        term: "alpha",
        concise_definition: "第一个",
      },
      {
        id: "k2",
        item_type: "word_sense",
        term: "beta",
        concise_definition: "第二个",
      },
    ]
    mocks.listKnowledge.mockResolvedValue({ count: 2, items })
    let resolveFirst!: (item: unknown) => void
    let resolveSecond!: (item: unknown) => void
    mocks.getKnowledge
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveSecond = resolve
        }),
      )

    render(<Knowledge />)
    fireEvent.click(await screen.findByRole("button", { name: /beta/ }))

    resolveFirst({ id: "k1", item_type: "word_sense", term: "alpha", concise_definition: "第一个", detailed_markdown: "STALE MARKDOWN" })
    await Promise.resolve()
    expect(screen.queryByText("STALE MARKDOWN")).not.toBeInTheDocument()

    resolveSecond({ id: "k2", item_type: "word_sense", term: "beta", concise_definition: "第二个", detailed_markdown: "FRESH MARKDOWN" })
    fireEvent.click(await screen.findByRole("tab", { name: "详细百科" }))
    expect(await screen.findByText("FRESH MARKDOWN")).toBeInTheDocument()
    expect(screen.queryByText("STALE MARKDOWN")).not.toBeInTheDocument()
  })

  it("keeps the summary usable when detail retrieval fails", async () => {
    mocks.listKnowledge.mockResolvedValueOnce({
      count: 1,
      items: [{
        id: "k1",
        item_type: "word_sense",
        term: "abandon",
        concise_definition: "放弃；抛弃",
      }],
    })
    mocks.getKnowledge.mockRejectedValueOnce(new Error("offline"))

    render(<Knowledge />)

    expect(await screen.findByRole("heading", { name: "abandon" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "详细百科" }))
    expect(await screen.findByText(/还没有详细百科/)).toBeInTheDocument()
  })

  it("filters by a knowledge group", async () => {
    mocks.listKnowledge.mockResolvedValueOnce({ count: 0, items: [] })
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("combobox", { name: "知识分组" }))
    const option = await screen.findByRole("option", { name: "abandon 词族" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenCalledWith({ query: "", group: "g1", limit: 100, offset: 0 }))
  })

  it("filters by subject from the toolbar", async () => {
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("combobox", { name: "学科" }))
    const option = await screen.findByRole("option", { name: "数学" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ subject: "math" })))
  })

  it("filters by special attribute tags", async () => {
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("combobox", { name: "属性" }))
    const option = await screen.findByRole("option", { name: "二级结论" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ tag: "二级结论" })))
  })

  it("compares two knowledge points", async () => {
    mocks.listKnowledge.mockResolvedValueOnce({
      count: 2,
      items: [
        { id: "k1", item_type: "word_sense", term: "abandon", concise_definition: "放弃" },
        { id: "k2", item_type: "word_sense", term: "resilient", concise_definition: "有韧性的" },
      ],
    })
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("combobox", { name: "对比对象 A" }))
    const optionA = await screen.findByRole("option", { name: "abandon" })
    fireEvent.pointerDown(optionA)
    fireEvent.click(optionA)
    fireEvent.click(screen.getByRole("combobox", { name: "对比对象 B" }))
    const optionB = await screen.findByRole("option", { name: "resilient" })
    fireEvent.pointerDown(optionB)
    fireEvent.click(optionB)
    fireEvent.click(screen.getByRole("button", { name: "对比" }))

    expect(await screen.findByText("速度与加速度的对比")).toBeInTheDocument()
    expect(mocks.compareKnowledge).toHaveBeenCalled()
  })
})
