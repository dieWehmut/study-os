import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Integrate from "./Integrate"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  createIntegrate: vi.fn(),
  listIntegrateNotes: vi.fn(),
  getIntegrateNote: vi.fn(),
  listKnowledge: vi.fn(),
}))

vi.mock("@/api/integrate", () => ({
  createIntegrate: mocks.createIntegrate,
  listIntegrateNotes: mocks.listIntegrateNotes,
  getIntegrateNote: mocks.getIntegrateNote,
}))
vi.mock("@/api/knowledge", () => ({ listKnowledge: mocks.listKnowledge }))

describe("Integrate page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    mocks.listKnowledge.mockResolvedValue({ items: [], count: 0 })
    mocks.listIntegrateNotes.mockResolvedValue({ items: [], count: 0 })
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
    render(<Integrate />)

    fireEvent.change(screen.getByLabelText("整合资料来源"), { target: { value: "速度描述快慢。加速度描述变化快慢。" } })
    fireEvent.click(screen.getByRole("button", { name: "生成导图与卡片" }))

    await waitFor(() => expect(mocks.createIntegrate).toHaveBeenCalled())
    expect((await screen.findAllByText("运动学整合")).length).toBeGreaterThan(0)
    expect(screen.getByRole("tree", { name: "导图：运动学整合" })).toBeInTheDocument()
    expect(screen.getByText("速度描述运动的快慢。")).toBeInTheDocument()
    expect(screen.getAllByText("二级结论").length).toBeGreaterThan(0)
  })

  it("builds a map from the document's own structure, without asking a model", async () => {
    render(<Integrate />)

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
    render(<Integrate />)

    fireEvent.change(screen.getByLabelText("整合资料来源"), {
      target: { value: "# 运动学\n## 速度" },
    })
    fireEvent.click(screen.getByRole("button", { name: /按结构生成/ }))

    expect(await screen.findByText(/来自原文结构/)).toBeInTheDocument()
  })

  it("shows one map at a time, whichever was asked for last", async () => {
    render(<Integrate />)

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
    render(<Integrate />)

    expect(screen.getByRole("button", { name: /按结构生成/ })).toBeDisabled()
  })
})
