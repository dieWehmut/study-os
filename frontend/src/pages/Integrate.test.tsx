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
    expect(screen.getByRole("img", { name: "导图：运动学整合" })).toBeInTheDocument()
    expect(screen.getByText("速度描述运动的快慢。")).toBeInTheDocument()
    expect(screen.getAllByText("二级结论").length).toBeGreaterThan(0)
  })
})
