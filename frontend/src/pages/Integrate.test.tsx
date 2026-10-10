import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Integrate from "./Integrate"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  createIntegrate: vi.fn(),
  listIntegrateNotes: vi.fn(),
  getIntegrateNote: vi.fn(),
  listKnowledge: vi.fn(),
  createLesson: vi.fn(),
  dumpThought: vi.fn(),
  scheduleKnowledge: vi.fn(),
}))

vi.mock("@/api/integrate", () => ({
  createIntegrate: mocks.createIntegrate,
  listIntegrateNotes: mocks.listIntegrateNotes,
  getIntegrateNote: mocks.getIntegrateNote,
}))
vi.mock("@/api/knowledge", () => ({
  listKnowledge: mocks.listKnowledge,
  scheduleKnowledge: mocks.scheduleKnowledge,
}))
vi.mock("@/api/chat", () => ({ dumpThought: mocks.dumpThought }))
vi.mock("@/api/lessons", () => ({ createLesson: mocks.createLesson }))

// 存成课程 navigates to the lesson it just made, so the page needs a router.
function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/integrate"]}>
      <Routes>
        <Route path="/integrate" element={<Integrate />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("Integrate page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    mocks.listKnowledge.mockResolvedValue({ items: [], count: 0 })
    mocks.listIntegrateNotes.mockResolvedValue({ items: [], count: 0 })
    mocks.dumpThought.mockImplementation((note: string) => Promise.resolve({ id: `dump-${note.slice(0, 4)}`, term: note.split("\n")[0] }))
    mocks.scheduleKnowledge.mockResolvedValue({ status: "scheduled", knowledge_id: "dump-1", prompt_count: 3 })
    mocks.createIntegrate.mockResolvedValue({
      id: "note-1",
      subject: "physics",
      title: "运动学整合",
      mindmap: {
        title: "运动学整合",
        nodes: [
          { id: "n0", label: "运动学整合", node_type: "root" },
          { id: "n1", label: "速度描述快慢", parent_id: "n0", node_type: "branch" },
        ],
      },
      cards: [
        { id: "c1", card_type: "concept", title: "速度", body: "速度描述运动的快慢。", tags: ["physics"] },
        { id: "c2", card_type: "conclusion", title: "二级结论", body: "匀变速运动中加速度恒定。", tags: [] },
      ],
      created_at: "2026-08-04T00:00:00Z",
    })
  })

  it("generates a mindmap and cards from text", async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText("整合资料来源"), { target: { value: "速度描述快慢。加速度描述变化快慢。" } })
    fireEvent.click(screen.getByRole("button", { name: "生成导图与卡片" }))

    await waitFor(() => expect(mocks.createIntegrate).toHaveBeenCalled())
    expect((await screen.findAllByText("运动学整合")).length).toBeGreaterThan(0)
    expect(screen.getByRole("tree", { name: "导图：运动学整合" })).toBeInTheDocument()
    expect(screen.getByText("速度描述运动的快慢。")).toBeInTheDocument()
    expect(screen.getAllByText("二级结论").length).toBeGreaterThan(0)
  })

  it("builds a map from the document's own structure, without asking a model", async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText("整合资料来源"), {
      target: { value: "# 运动学\n## 速度\n描述快慢。\n## 加速度" },
    })
    fireEvent.click(screen.getByRole("button", { name: /按结构生成/ }))

    expect(await screen.findByRole("tree", { name: "导图：运动学" })).toBeInTheDocument()
    expect(screen.getByRole("treeitem", { name: "加速度" })).toBeInTheDocument()
    expect(mocks.createIntegrate).not.toHaveBeenCalled()
  })

  it("says which map came from the document rather than from a model", async () => {
    // The two paths produce the same kind of picture. Without a label, a map
    // a model invented is indistinguishable from one the document dictated.
    renderPage()

    fireEvent.change(screen.getByLabelText("整合资料来源"), {
      target: { value: "# 运动学\n## 速度" },
    })
    fireEvent.click(screen.getByRole("button", { name: /按结构生成/ }))

    expect(await screen.findByText(/来自原文结构/)).toBeInTheDocument()
  })

  it("shows one map at a time, whichever was asked for last", async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText("整合资料来源"), {
      target: { value: "# 运动学\n## 速度" },
    })
    fireEvent.click(screen.getByRole("button", { name: /按结构生成/ }))
    await screen.findByRole("tree", { name: "导图：运动学" })

    fireEvent.click(screen.getByRole("button", { name: "生成导图与卡片" }))

    await waitFor(() =>
      expect(screen.queryByRole("tree", { name: "导图：运动学" })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole("tree", { name: "导图：运动学整合" })).toBeInTheDocument()
  })

  it("has nothing to build a structure from until something is pasted", () => {
    renderPage()

    expect(screen.getByRole("button", { name: /按结构生成/ })).toBeDisabled()
  })

  it("keeps the whiteboard research catalogue beside the integration workbench", () => {
    renderPage()

    expect(screen.getByRole("heading", { name: "白板能力目录" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "进阶能力" }))
    expect(screen.getByText("知识图谱与路径回放")).toBeInTheDocument()
  })

  it("hands a saved note to 课程 as a reference, not as a document", async () => {
    // The 课程 page tells an empty library to 去整合资料; this is the end of that
    // sentence. The note already holds the cards and the map, and the server is
    // the one place that decides how those become sections.
    mocks.createLesson.mockResolvedValue({ id: "lesson-9", title: "运动学整合" })
    renderPage()

    fireEvent.change(screen.getByLabelText("整合资料来源"), { target: { value: "速度描述快慢。" } })
    fireEvent.click(screen.getByRole("button", { name: "生成导图与卡片" }))
    await screen.findByRole("tree", { name: "导图：运动学整合" })

    fireEvent.click(screen.getByRole("button", { name: "存成课程" }))

    await waitFor(() =>
      expect(mocks.createLesson).toHaveBeenCalledWith({
        // The note's own subject, not the page's 综合: a 物理 note belongs to 物理.
        subject: "physics",
        title: "运动学整合",
        source_type: "integrated_note",
        source_id: "note-1",
      }),
    )
    expect(await screen.findByTestId("location")).toHaveTextContent("/lessons/lesson-9")
  })

  it("sends the pasted structure itself when it was never saved as a note", async () => {
    mocks.createLesson.mockResolvedValue({ id: "lesson-10", title: "运动学" })
    renderPage()

    fireEvent.change(screen.getByLabelText("整合资料来源"), {
      target: { value: "# 运动学\n## 速度\n描述快慢。" },
    })
    fireEvent.click(screen.getByRole("button", { name: /按结构生成/ }))
    await screen.findByRole("tree", { name: "导图：运动学" })

    fireEvent.click(screen.getByRole("button", { name: "存成课程" }))

    await waitFor(() => expect(mocks.createLesson).toHaveBeenCalledWith(expect.objectContaining({
      title: "运动学",
      document: {
        schema_version: 1,
        sections: [{ type: "visualization", content: { markdown: "# 运动学\n## 速度\n描述快慢。" } }],
      },
    })))
    expect(mocks.createLesson.mock.calls[0][0]).not.toHaveProperty("source_id")
  })

  it("files every generated card into 复习, title first", async () => {
    // 整合 produces cards by definition and there was no way to be asked them.
    renderPage()

    fireEvent.change(screen.getByLabelText("整合资料来源"), { target: { value: "速度描述快慢。" } })
    fireEvent.click(screen.getByRole("button", { name: "生成导图与卡片" }))
    await screen.findByRole("tree", { name: "导图：运动学整合" })

    fireEvent.click(screen.getByRole("button", { name: "把这 2 张卡排进复习" }))

    await waitFor(() => expect(mocks.dumpThought).toHaveBeenCalledTimes(2))
    expect(mocks.dumpThought.mock.calls[0][0]).toBe("速度\n\n速度描述运动的快慢。")
    expect(mocks.dumpThought.mock.calls[1][0]).toBe("二级结论\n\n匀变速运动中加速度恒定。")
    // Filing without queueing leaves an item the due queue can never see.
    expect(mocks.scheduleKnowledge).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole("status")).toHaveTextContent("已排进复习：2 张卡 · 6 个问题等着")
    expect(screen.getByRole("button", { name: "已全部排进复习" })).toBeDisabled()
  })

  it("does not file the same card twice when the button is pressed again", async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText("整合资料来源"), { target: { value: "速度描述快慢。" } })
    fireEvent.click(screen.getByRole("button", { name: "生成导图与卡片" }))
    await screen.findByRole("tree", { name: "导图：运动学整合" })

    fireEvent.click(screen.getByRole("button", { name: "把这 2 张卡排进复习" }))
    await waitFor(() => expect(mocks.dumpThought).toHaveBeenCalledTimes(2))
    // The control is spent once everything is filed, and pressing it is a no-op.
    expect(screen.getByRole("button", { name: "已全部排进复习" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "已全部排进复习" }))

    expect(mocks.dumpThought).toHaveBeenCalledTimes(2)
  })

  it("names which half failed when a card is filed but not queued", async () => {
    mocks.scheduleKnowledge.mockRejectedValueOnce(new Error("offline"))
    renderPage()

    fireEvent.change(screen.getByLabelText("整合资料来源"), { target: { value: "速度描述快慢。" } })
    fireEvent.click(screen.getByRole("button", { name: "生成导图与卡片" }))
    await screen.findByRole("tree", { name: "导图：运动学整合" })

    fireEvent.click(screen.getByRole("button", { name: "把这 2 张卡排进复习" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("已收进知识库 2 张")
    expect(alert).toHaveTextContent("1 张没排上复习")
  })

  it("says the history is longer when it cannot show all of it", async () => {
    // The list answers a page with no total, so without asking for one row too
    // many the card would call 20 records "the history".
    const notes = Array.from({ length: 21 }, (_, index) => ({
      id: `note-${index}`,
      title: `第 ${index} 份整合`,
      subject: "physics",
      mindmap: { title: "图", nodes: [] },
      cards: [],
      created_at: "2026-08-04T00:00:00Z",
    }))
    mocks.listIntegrateNotes.mockResolvedValue({ items: notes, count: notes.length })
    renderPage()

    expect(await screen.findByText(/显示最近 20 份/)).toBeInTheDocument()
    expect(await screen.findByText("第 0 份整合")).toBeInTheDocument()
    expect(screen.queryByText("第 20 份整合")).not.toBeInTheDocument()
    expect(mocks.listIntegrateNotes).toHaveBeenCalledWith("", 21)
  })

  it("says nothing about truncation when the history is complete", async () => {
    renderPage()

    await screen.findByText(/点击查看之前生成过的导图与卡片/)
    expect(screen.queryByText(/显示最近 20 份/)).not.toBeInTheDocument()
  })
})
