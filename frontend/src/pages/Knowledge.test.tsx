import type { ReactElement } from "react"
import { fireEvent, render as renderUI, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Knowledge from "./Knowledge"
import { ApiError } from "@/api/client"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  getKnowledge: vi.fn(),
  getKnowledgeMastery: vi.fn(),
  listKnowledge: vi.fn(),
  listGroups: vi.fn(),
  listRelatedKnowledge: vi.fn(),
  scheduleKnowledge: vi.fn(),
  compareKnowledge: vi.fn(),
  updateKnowledgeTag: vi.fn(),
  exportKnowledge: vi.fn(),
}))

vi.mock("@/api/knowledge", () => mocks)
vi.mock("@/api/chat", () => ({
  compareKnowledge: mocks.compareKnowledge,
  updateKnowledgeTag: mocks.updateKnowledgeTag,
}))

function render(ui: ReactElement, initialEntries = ["/knowledge"]) {
  return renderUI(
    <MemoryRouter initialEntries={initialEntries}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
  )
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="current location">{location.pathname}{location.search}</output>
}

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
    mocks.getKnowledgeMastery.mockResolvedValue({
      knowledge_item_id: "k1",
      subject: "english",
      dimensions: [],
    })
    mocks.listGroups.mockResolvedValue({
      count: 2,
      items: [
        { id: "g1", name: "abandon 词族", kind: "word_family", item_count: 3 },
        // -1 is "could not be counted": the chip must not claim the group is empty.
        { id: "g2", name: "水循环", kind: "topic", item_count: -1 },
      ],
    })
    // Most items belong to no group, so the quiet answer is the default one.
    mocks.listRelatedKnowledge.mockResolvedValue({ items: [], groups: [] })
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

  it("lists the 知识分组 with how many items each holds, and filters from there", async () => {
    // The groups were a dropdown of names only: a name does not say whether the group
    // is worth opening, and an uncountable group must not read as an empty one.
    render(<Knowledge />)

    const chip = await screen.findByRole("button", { name: /abandon 词族/ })
    expect(chip.textContent).toContain("3")
    const uncounted = screen.getByRole("button", { name: "水循环" })
    expect(uncounted.textContent).toBe("水循环")
    // 全部 carries the total, so the row reads as one scale rather than as a chip with
    // a missing number. (It only shows while 全部 is the active filter: beside a
    // filtered list the number would be the filtered count, not the library's.)
    const allChip = document.querySelector("[data-group-chip='all']")
    expect(allChip).not.toBeNull()
    expect(allChip!.textContent).toContain("1")

    fireEvent.click(chip)
    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ group: "g1" }),
    ))
  })

  it("marks the row the server reports as 已归档", async () => {
    // The widened view is the only place an archived row appears, and without the mark the
    // reader can see them but cannot tell which ones they put away themselves.
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [{ id: "k1", item_type: "word_sense", term: "abandon", concise_definition: "放弃；抛弃" }],
      archived_ids: ["k1"],
    })
    render(<Knowledge />)

    const marker = await screen.findByText("已归档")
    expect(marker).toHaveAttribute("data-archived-marker", "true")
  })

  it("asks for archived items when the reader switches 显示已归档 on", async () => {
    // 归档 hides by default, so this switch is the way back to them -- and it has to reach
    // the server, because the list only ever held the visible page.
    render(<Knowledge />)

    const toggle = await screen.findByRole("button", { name: "显示已归档" })
    expect(toggle).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(toggle)

    await waitFor(() =>
      expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ archived: "yes" })),
    )

    // And the file follows the switch: exporting from this view must not hand over a
    // smaller library than the screen is showing.
    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }))
    await waitFor(() =>
      expect(mocks.exportKnowledge).toHaveBeenCalledWith(expect.objectContaining({ archived: "yes" })),
    )
  })

  it("says on each row whether it is in the review plan", async () => {
    // An item nobody scheduled is one that will never be asked about. The 复习状态
    // filter could tell you that about a whole list; the row is where it is true of
    // the thing you are looking at.
    mocks.listKnowledge.mockResolvedValue({
      count: 2,
      items: [
        { id: "k1", item_type: "word_sense", term: "在计划里", concise_definition: "释义" },
        { id: "k2", item_type: "word_sense", term: "不在计划里", concise_definition: "释义" },
      ],
      scheduled_ids: ["k1"],
    })
    render(<Knowledge />)

    const scheduled = await screen.findByText("在计划里")
    const row = scheduled.closest("[data-scheduled-marker], div")
    expect(row).not.toBeNull()
    expect(document.querySelectorAll("[data-scheduled-marker='yes']").length).toBe(1)
    expect(document.querySelectorAll("[data-scheduled-marker='no']").length).toBe(1)
    expect(screen.getByText("还没排复习")).toBeInTheDocument()
  })

  it("renders a selected item in concise and detail tabs", async () => {
    render(<Knowledge />)

    expect(await screen.findByRole("heading", { name: "abandon" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "简明" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "详细百科" }))

    expect(await screen.findByText("To leave something behind.")).toBeInTheDocument()
  })

  it("copies the address of the item on screen", async () => {
    // The page opens on ?item=, so this is the link a reader can keep.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    render(<Knowledge />)
    await screen.findByRole("heading", { name: "abandon" })

    fireEvent.click(screen.getByRole("button", { name: /复制链接/ }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0][0]).toContain("/knowledge?item=k1")

    // And it says so, rather than leaving the reader wondering if it worked.
    expect(await screen.findByRole("button", { name: /已复制链接/ })).toBeInTheDocument()
  })

  it("opens an item requested by the query even when the current list omits it", async () => {
    mocks.listKnowledge.mockResolvedValueOnce({ count: 0, items: [] })
    mocks.getKnowledge.mockResolvedValueOnce({
      id: "k-complicated",
      item_type: "word_wiki",
      term: "complicated",
      concise_definition: "complex",
      detailed_markdown: "## Usage\n\nA complicated question.",
    })

    render(<Knowledge />, ["/knowledge?item=k-complicated"])

    await waitFor(() => expect(mocks.getKnowledge).toHaveBeenCalledWith("k-complicated"))
    expect(await screen.findByRole("heading", { name: "complicated" })).toBeInTheDocument()
  })

  it("reports a failed query-selected detail and retries it", async () => {
    mocks.listKnowledge.mockResolvedValue({ count: 0, items: [] })
    mocks.getKnowledge
      .mockRejectedValueOnce(new Error("detail unavailable"))
      .mockResolvedValueOnce({
        id: "k-complicated",
        item_type: "word_wiki",
        term: "complicated",
        concise_definition: "complex",
      })

    render(<Knowledge />, ["/knowledge?item=k-complicated"])

    // Nothing answered, so the page says what that usually means rather than
    // passing on an English internal from a thrown Error.
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取知识点详情，请确认本地后端正在运行。")
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByRole("heading", { name: "complicated" })).toBeInTheDocument()
    expect(mocks.getKnowledge).toHaveBeenCalledTimes(2)
  })

  it("keeps a query-selected detail visible when the surrounding list fails", async () => {
    mocks.listKnowledge.mockRejectedValueOnce(new Error("list unavailable"))
    mocks.getKnowledge.mockResolvedValueOnce({
      id: "k-complicated",
      item_type: "word_wiki",
      term: "complicated",
      concise_definition: "complex",
    })

    render(<Knowledge />, ["/knowledge?item=k-complicated"])

    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取知识库，请确认本地后端正在运行。")
    expect(await screen.findByRole("heading", { name: "complicated" })).toBeInTheDocument()
  })

  it("updates the query when another knowledge item is selected", async () => {
    mocks.listKnowledge.mockResolvedValueOnce({
      count: 2,
      items: [
        { id: "k1", item_type: "word_sense", term: "alpha", concise_definition: "first" },
        { id: "k2", item_type: "word_sense", term: "beta", concise_definition: "second" },
      ],
    })

    render(<Knowledge />)
    fireEvent.click(await screen.findByRole("button", { name: /beta/ }))

    expect(await screen.findByLabelText("current location")).toHaveTextContent("/knowledge?item=k2")
    expect(await screen.findByRole("heading", { name: "beta" })).toBeInTheDocument()
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

  it("draws the wiki's own headings as a map", async () => {
    // 0807:75 「只要 wiki 本身是 markdown 格式的信息，那其实靠固定的程序就能实现
    // 文转 mindmap」. The markdown is already on this panel; the map is a second
    // reading of it rather than a second document, which is why it hangs off the
    // wiki instead of opening a page of its own (ROADMAP §5.4).
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("tab", { name: "导图" }))

    expect(await screen.findByRole("tree", { name: "导图：abandon" })).toBeInTheDocument()
    expect(screen.getByRole("treeitem", { name: /^Usage$/ })).toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole("button", { name: "语文" }))

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

describe("showing the rest of a word's family", () => {
  const abandon = {
    id: "k1",
    item_type: "word_sense",
    subject: "english",
    term: "abandon",
    concise_definition: "放弃；抛弃",
  }
  const abandonment = {
    id: "k2",
    item_type: "word_sense",
    subject: "english",
    term: "abandonment",
    concise_definition: "放弃（名词）",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    mocks.listGroups.mockResolvedValue({ count: 0, items: [] })
    // Only 一个 word is in the list: the family lives behind a group id the
    // list was never told, which is the whole reason this section exists.
    mocks.listKnowledge.mockResolvedValue({ count: 1, items: [abandon] })
    mocks.getKnowledge.mockImplementation((id: string) =>
      Promise.resolve(id === "k2" ? abandonment : abandon),
    )
    mocks.listRelatedKnowledge.mockResolvedValue({
      items: [abandonment],
      groups: [{ id: "g1", name: "abandon 词族", kind: "word_family" }],
    })
  })

  it("names the family and lists the words in it", async () => {
    // 错因 advice already says "同词族的其他词一起过" -- until now nothing in
    // the app could show you which words those were.
    render(<Knowledge />)

    const family = await screen.findByRole("region", { name: "词族" })
    expect(within(family).getByText("abandon 词族")).toBeInTheDocument()
    expect(within(family).getByRole("button", { name: /abandonment/ })).toBeInTheDocument()
    expect(mocks.listRelatedKnowledge).toHaveBeenCalledWith("k1")
  })

  it("opens a family word the current filter left out of the list", async () => {
    // The sibling is not in `items` -- a search, a subject chip or 复习状态 will
    // routinely exclude it. A family link that dead-ends on the empty panel is
    // a broken link, so the panel has to follow the id, not the visible list.
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("button", { name: /abandonment/ }))

    await waitFor(() => expect(mocks.getKnowledge).toHaveBeenCalledWith("k2"))
    expect(await screen.findByRole("heading", { name: "abandonment" })).toBeInTheDocument()
  })

  it("says nothing at all about a word that belongs to no family", async () => {
    // Most items are in no group. An empty 词族 heading on every one of them
    // would be a permanent reminder of something that is not missing.
    mocks.listRelatedKnowledge.mockResolvedValue({ items: [], groups: [] })
    render(<Knowledge />)

    expect(await screen.findByRole("heading", { name: "abandon" })).toBeInTheDocument()
    // Under either name: an empty block relabelled 同组知识点 is the same
    // permanent reminder of something that is not missing.
    expect(screen.queryByRole("region", { name: /^(词族|同组知识点)$/ })).not.toBeInTheDocument()
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

  it("reads the 复习状态 of a linked item the page does not carry", async () => {
    // A 词族 link or an ?item= deep link selects a word the current search,
    // subject or 复习状态 filter had every right to exclude -- and scheduled_ids
    // only describes the page in hand. The panel then offered 排进复习 for
    // something already queued, which is the one state it must not get wrong.
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [{ id: "k1", item_type: "word_sense", term: "abandon", concise_definition: "放弃" }],
      scheduled_ids: [],
    })
    mocks.listRelatedKnowledge.mockResolvedValue({ items: [], groups: [] })
    mocks.getKnowledge.mockResolvedValue({
      id: "k9",
      item_type: "word_sense",
      term: "resilient",
      concise_definition: "有韧性的",
      scheduled: true,
    })

    render(<Knowledge />, ["/knowledge?item=k9"])

    await waitFor(() => expect(mocks.getKnowledge).toHaveBeenCalledWith("k9"))
    expect(await screen.findByRole("button", { name: /已排进复习/ })).toBeDisabled()
    expect(screen.queryByRole("button", { name: /^排进复习/ })).not.toBeInTheDocument()
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

  it("opens already narrowed when the link asks for it", async () => {
    // "What still needs scheduling?" is a question another page sends you here
    // to answer, so the filter has to be in the link rather than only in state.
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [{ id: "k1", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。" }],
    })

    render(<Knowledge />, ["/knowledge?scheduled=no"])

    await waitFor(() => {
      expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ scheduled: "no" }))
    })
    expect(await screen.findByRole("combobox", { name: "复习状态" })).toHaveTextContent("还没排复习")
  })

  it("writes the chosen filter back into the link so a reload keeps it", async () => {
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

    await waitFor(() => expect(screen.getByLabelText("current location")).toHaveTextContent("scheduled=yes"))

    fireEvent.click(screen.getByRole("combobox", { name: "复习状态" }))
    const all = await screen.findByRole("option", { name: "全部" })
    fireEvent.pointerDown(all)
    fireEvent.click(all)

    await waitFor(() => expect(screen.getByLabelText("current location")).not.toHaveTextContent("scheduled="))
  })

  it("stops asking you to pick from a list the filters emptied", async () => {
    // The panel's placeholder said 选择一个知识点查看百科 while the filter had
    // left nothing to pick -- arriving from 记忆 with ?scheduled=no and every
    // point already queued is exactly that page.
    mocks.listKnowledge.mockResolvedValue({ count: 0, items: [], scheduled_ids: [] })
    render(<Knowledge />, ["/knowledge?scheduled=no"])

    expect(await screen.findByText("当前筛选下没有知识点")).toBeInTheDocument()
    expect(screen.queryByText("选择一个知识点查看百科")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }))

    await waitFor(() => {
      const last = mocks.listKnowledge.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(last.scheduled).toBeUndefined()
    })
    expect(await screen.findByText("选择一个知识点查看百科")).toBeInTheDocument()
  })

  it("loads the next page instead of stopping at the first hundred", async () => {
    // The page says how many match, so one request of 100 is not the library --
    // and 搜索 answers "is it there", not "what else is".
    const page = (offset: number) =>
      offset === 0
        ? { count: 4, items: Array.from({ length: 3 }, (_, index) => ({ id: `k${index}`, item_type: "word_sense", term: `第 ${index} 个`, concise_definition: "释义" })), scheduled_ids: [] }
        : { count: 4, items: [{ id: "k3", item_type: "word_sense", term: "第四页", concise_definition: "释义" }], scheduled_ids: ["k3"] }
    mocks.listKnowledge.mockImplementation((options?: { offset?: number }) => Promise.resolve(page(options?.offset ?? 0)))
    render(<Knowledge />)
    await screen.findByRole("button", { name: /第 0 个/ })

    fireEvent.click(screen.getByRole("button", { name: "加载更多（还有 1 条）" }))

    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ offset: 3 })))
    expect(await screen.findByRole("button", { name: /第四页/ })).toBeInTheDocument()
    // Nothing left, so nothing left to offer.
    expect(screen.queryByRole("button", { name: /加载更多/ })).not.toBeInTheDocument()
    // The rows the page already had keep their 复习状态.
    expect(await screen.findByRole("button", { name: /第 1 个/ })).toBeInTheDocument()
  })

  it("offers nothing to load when the first page is the whole library", async () => {
    mocks.listKnowledge.mockResolvedValue({
      count: 1,
      items: [{ id: "k1", item_type: "word_sense", term: "只有一个", concise_definition: "释义" }],
      scheduled_ids: [],
    })
    render(<Knowledge />)
    await screen.findByRole("button", { name: /只有一个/ })

    expect(screen.queryByRole("button", { name: /加载更多/ })).not.toBeInTheDocument()
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

  it("hands the reader the library as a file of what is on screen", async () => {
    // 导入 could read a file and nothing could write one; the pair is only a loop
    // if the export carries the filters the reader set.
    mocks.exportKnowledge.mockResolvedValue("term,definition\nabandon,放弃；抛弃\n")
    const downloads: string[] = []
    const originalClick = HTMLAnchorElement.prototype.click
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      downloads.push(this.download)
    }
    URL.createObjectURL = vi.fn(() => "blob:study-os") as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    try {
      render(<Knowledge />)
      const exportButton = await screen.findByRole("button", { name: "导出 CSV" })
      fireEvent.change(screen.getByLabelText("搜索知识库"), { target: { value: "ab" } })
      fireEvent.click(exportButton)

      await waitFor(() => expect(mocks.exportKnowledge).toHaveBeenCalledWith({
        format: "csv",
        query: "ab",
        subject: undefined,
        tag: undefined,
        scheduled: undefined,
      }))
      expect(downloads[0]).toMatch(/\.csv$/)
      // The object URL is revoked again: a page-long blob leaks the export.
      await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:study-os"))
    } finally {
      HTMLAnchorElement.prototype.click = originalClick
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  it("says so when the export fails instead of downloading nothing", async () => {
    mocks.exportKnowledge.mockRejectedValue(new ApiError(400, "format 只支持 csv 或 jsonl"))
    render(<Knowledge />)

    fireEvent.click(await screen.findByRole("button", { name: "导出 CSV" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("导出失败：format 只支持 csv 或 jsonl")
  })
})
