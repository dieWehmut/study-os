import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Knowledge from "./Knowledge"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  getKnowledge: vi.fn(),
  listKnowledge: vi.fn(),
  listGroups: vi.fn(),
  scheduleKnowledge: vi.fn(),
  compareKnowledge: vi.fn(),
  updateKnowledgeTag: vi.fn(),
}))

vi.mock("@/api/knowledge", () => mocks)
vi.mock("@/api/chat", () => ({
  compareKnowledge: mocks.compareKnowledge,
  updateKnowledgeTag: mocks.updateKnowledgeTag,
}))

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
    mocks.scheduleKnowledge.mockResolvedValue({
      status: "scheduled",
      knowledge_id: "k1",
      prompt_count: 3,
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

    fireEvent.click(await screen.findByRole("button", { name: "数学" }))
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

  it("offers a subject its own insight types to filter by", async () => {
    // 化学 does not sort its conclusions into 二级结论; it sorts them into
    // 考点 / 题型 / 易错点. Offering only the generic words loses the sort.
    useSubjectStore.setState({ subject: "chemistry" })
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("combobox", { name: "属性" }))
    const option = await screen.findByRole("option", { name: "考点" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ tag: "考点" })))
  })

  it("clears a tag filter the new subject has no word for", async () => {
    // Filter 化学 by 考点, then switch to 语文: the dropdown no longer offers
    // 考点, so the list would stay filtered by something you can no longer see
    // or unset from the control that set it.
    useSubjectStore.setState({ subject: "chemistry" })
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("combobox", { name: "属性" }))
    const option = await screen.findByRole("option", { name: "考点" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ tag: "考点" })))

    fireEvent.click(screen.getByRole("button", { name: "语文" }))

    await waitFor(() => {
      const last = mocks.listKnowledge.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(last.subject).toBe("chinese")
      expect(last.tag).toBeUndefined()
    })
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

describe("sending a knowledge point into the review queue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    mocks.listGroups.mockResolvedValue({ count: 0, items: [] })
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [{ id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。" }],
    })
    mocks.getKnowledge.mockResolvedValue({
      id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。",
    })
    mocks.scheduleKnowledge.mockResolvedValue({ status: "scheduled", knowledge_id: "k1", prompt_count: 3 })
  })

  it("offers a way from the library into the review queue", async () => {
    // Everything 阅读 files and everything the 暂存 box saves lands here with
    // no prompts, which the due query cannot see. Without this control the
    // library is where knowledge goes to be counted and never asked about.
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("button", { name: /排进复习/ }))

    await waitFor(() => expect(mocks.scheduleKnowledge).toHaveBeenCalledWith("k1"))
  })

  it("says how many cards it made, so the click has a visible result", async () => {
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("button", { name: /排进复习/ }))

    expect(await screen.findByText(/3 张卡/)).toBeInTheDocument()
  })

  it("does not send the same item twice", async () => {
    // The queue has no undo, so a second press must not be possible from a
    // control that already reported success.
    render(<Knowledge />)

    const button = await screen.findByRole("button", { name: /排进复习/ })
    fireEvent.click(button)
    await screen.findByText(/3 张卡/)
    fireEvent.click(button)

    expect(mocks.scheduleKnowledge).toHaveBeenCalledTimes(1)
  })

  it("says an item was already queued rather than claiming it just made cards", async () => {
    // The backend answers idempotently, and reporting that as a fresh success
    // would tell you cards were created when none were.
    mocks.scheduleKnowledge.mockResolvedValueOnce({
      status: "already_scheduled",
      knowledge_id: "k1",
      prompt_count: 3,
    })
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("button", { name: /排进复习/ }))

    expect(await screen.findByText(/已经在复习计划里/)).toBeInTheDocument()
  })

  it("stays pressable when the schedule fails", async () => {
    // A control that looks done when nothing was written is worse than one
    // that failed loudly.
    mocks.scheduleKnowledge.mockRejectedValueOnce(new Error("offline"))
    render(<Knowledge />)

    const button = await screen.findByRole("button", { name: /排进复习/ })
    fireEvent.click(button)

    expect(await screen.findByText(/排进复习失败/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /排进复习/ })).toBeEnabled()
  })

  it("does not carry one item's result onto the next", async () => {
    // The panel is remounted per item; a receipt that outlived its subject
    // would tell you the item you just opened is queued when it is not.
    mocks.listKnowledge.mockResolvedValue({
      count: 2,
      items: [
        { id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。" },
        { id: "k2", item_type: "brain_dump", term: "光合作用", concise_definition: "分为光反应和暗反应。" },
      ],
    })
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("button", { name: /排进复习/ }))
    await screen.findByText(/3 张卡/)
    fireEvent.click(screen.getByRole("button", { name: /光合作用/ }))

    expect(screen.queryByText(/3 张卡/)).not.toBeInTheDocument()
  })
})

describe("showing what is already in the review queue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    mocks.listGroups.mockResolvedValue({ count: 0, items: [] })
    mocks.getKnowledge.mockResolvedValue({
      id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。",
    })
    mocks.scheduleKnowledge.mockResolvedValue({ status: "scheduled", knowledge_id: "k1", prompt_count: 3 })
  })

  it("says an item is already queued before you press anything", async () => {
    // Otherwise the button reads the same on a queued item as on a loose one,
    // and the only way to find out is to press it -- on a queue with no undo.
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [{ id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。" }],
      scheduled_ids: ["k1"],
    })
    render(<Knowledge />)

    expect(await screen.findByRole("button", { name: /已排进复习/ })).toBeDisabled()
  })

  it("leaves an unqueued item pressable", async () => {
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [{ id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。" }],
      scheduled_ids: [],
    })
    render(<Knowledge />)

    expect(await screen.findByRole("button", { name: /^排进复习/ })).toBeEnabled()
  })

  it("keeps the mark on the right item when you switch between them", async () => {
    // The flags are per item and the panel is remounted per item; reading them
    // off anything but the id would carry one item's state onto the next.
    mocks.listKnowledge.mockResolvedValue({
      count: 2,
      items: [
        { id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。" },
        { id: "k2", item_type: "brain_dump", term: "光合作用", concise_definition: "分为光反应和暗反应。" },
      ],
      scheduled_ids: ["k2"],
    })
    render(<Knowledge />)
    expect(await screen.findByRole("button", { name: /^排进复习/ })).toBeEnabled()

    fireEvent.click(screen.getByRole("button", { name: /光合作用/ }))

    expect(await screen.findByRole("button", { name: /已排进复习/ })).toBeDisabled()
  })

  it("keeps the button usable when the server says nothing about queued items", async () => {
    // An older backend answers without the field. Treating a missing answer as
    // "queued" would lock the control on every item in the library.
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [{ id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。" }],
    })
    render(<Knowledge />)

    expect(await screen.findByRole("button", { name: /^排进复习/ })).toBeEnabled()
  })

  it("can narrow the library to the items that carry no review cards", async () => {
    // scheduled_ids only covers the page in hand. With 500 items behind a
    // limit of 100, filtering in the browser would answer "3 need scheduling"
    // when 200 do -- so the filter has to reach the server.
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [{ id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。" }],
    })
    render(<Knowledge />)
    await screen.findByRole("heading", { name: "动能定理" })

    fireEvent.click(screen.getByRole("combobox", { name: "复习状态" }))
    const option = await screen.findByRole("option", { name: "还没排复习" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    await waitFor(() => {
      expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ scheduled: "no" }))
    })
  })

  it("asks for the whole library again when the review filter is cleared", async () => {
    // A filter that cannot be undone is a trap: the page would keep hiding
    // rows after the learner stopped asking it to.
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [{ id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。" }],
    })
    render(<Knowledge />)
    await screen.findByRole("heading", { name: "动能定理" })
    fireEvent.click(screen.getByRole("combobox", { name: "复习状态" }))
    const queued = await screen.findByRole("option", { name: "已排进复习" })
    fireEvent.pointerDown(queued)
    fireEvent.click(queued)
    await waitFor(() => {
      expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ scheduled: "yes" }))
    })

    fireEvent.click(screen.getByRole("combobox", { name: "复习状态" }))
    const all = await screen.findByRole("option", { name: "全部" })
    fireEvent.pointerDown(all)
    fireEvent.click(all)

    await waitFor(() => {
      const last = mocks.listKnowledge.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(last.scheduled).toBeUndefined()
    })
  })
})

describe("tagging a knowledge point with an insight type", () => {
  function library(item: Record<string, unknown>) {
    mocks.listGroups.mockResolvedValue({ count: 0, items: [] })
    mocks.listKnowledge.mockResolvedValue({ count: 1, items: [item] })
    mocks.getKnowledge.mockResolvedValue(item)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
  })

  it("offers the item's own subject's types, not the generic ones", async () => {
    // The panel shows one item, so the item's subject decides -- reading the
    // toolbar chip instead would put 二级结论 on a 化学 point under 全部学科.
    library({
      id: "k1", item_type: "brain_dump", subject: "chemistry",
      term: "过量判断", concise_definition: "先算物质的量之比。", tags: [],
    })
    render(<Knowledge />)

    expect(await screen.findByRole("button", { name: "考点" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "二级结论" })).not.toBeInTheDocument()
  })

  it("keeps offering a tag the item carries from outside its vocabulary", async () => {
    // A tag you can see but not press is a tag you can never take off.
    library({
      id: "k1", item_type: "brain_dump", subject: "chemistry",
      term: "过量判断", concise_definition: "先算物质的量之比。", tags: ["二级结论"],
    })
    render(<Knowledge />)

    expect(await screen.findByRole("button", { name: "✓ 二级结论" })).toBeInTheDocument()
  })

  it("writes the tag the subject actually uses", async () => {
    library({
      id: "k1", item_type: "brain_dump", subject: "chemistry",
      term: "过量判断", concise_definition: "先算物质的量之比。", tags: [],
    })
    mocks.updateKnowledgeTag.mockResolvedValue({
      id: "k1", item_type: "brain_dump", subject: "chemistry",
      term: "过量判断", concise_definition: "先算物质的量之比。", tags: ["考点"],
    })
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("button", { name: "考点" }))

    await waitFor(() => expect(mocks.updateKnowledgeTag).toHaveBeenCalledWith("k1", "考点", false))
    expect(await screen.findByRole("button", { name: "✓ 考点" })).toBeInTheDocument()
  })
})
