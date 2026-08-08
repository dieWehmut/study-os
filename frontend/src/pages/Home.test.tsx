import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Home from "./Home"
import { readingStorageKey } from "@/lib/reading-session"

const halfRead = ["# 光合作用", "## 光反应", "在类囊体薄膜上进行。", "## 暗反应", "在叶绿体基质中进行。"].join("\n")

function leaveOpen(markdown: string, readIds: string[] = []) {
  localStorage.setItem(readingStorageKey, JSON.stringify({ markdown, index: 0, readIds }))
}

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  seedDemo: vi.fn(),
  dumpThought: vi.fn(),
}))

vi.mock("@/api/dashboard", () => mocks)
vi.mock("@/api/chat", () => ({ dumpThought: mocks.dumpThought }))

describe("Today page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.getDashboard.mockResolvedValue({
      knowledge_count: 1,
      prompt_count: 3,
      due_count: 3,
      attempt_count: 4,
      reviewed_today: 2,
      current_streak: 3,
      provider: "mock",
      offline: true,
      subjects_due: { english: 2 },
      recent_items: [{ id: "k1", term: "abandon", item_type: "word_sense", subject: "english" }],
    })
    mocks.seedDemo.mockResolvedValue({
      status: "seeded",
      knowledge_id: "demo-knowledge-abandon",
      prompt_count: 3,
    })
    mocks.dumpThought.mockResolvedValue({ id: "dump-1", term: "念头" })
  })

  it("shows live progress and links to the focused memory session", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    expect(await screen.findByText("3 个待复习")) .toBeInTheDocument()
    expect(screen.getByText("1 个知识点")) .toBeInTheDocument()
    expect(screen.getByText("本地 · 离线可用")) .toBeInTheDocument()

    expect(screen.getByRole("link", { name: "开始复习" })).toHaveAttribute("href", "/memory")
  })

  it("loads a usable example into an empty library", async () => {
    mocks.getDashboard
      .mockResolvedValueOnce({
        knowledge_count: 0,
        prompt_count: 0,
        due_count: 0,
        attempt_count: 0,
        reviewed_today: 0,
        current_streak: 0,
        provider: "mock",
        offline: true,
      })
      .mockResolvedValueOnce({
        knowledge_count: 1,
        prompt_count: 3,
        due_count: 3,
        attempt_count: 0,
        reviewed_today: 0,
        current_streak: 0,
        provider: "mock",
        offline: true,
      })

    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole("button", { name: "载入英语示例" }))
    expect(mocks.seedDemo).toHaveBeenCalledOnce()
    expect(await screen.findByText("3 个待复习")) .toBeInTheDocument()
  })

  it("shows a retry action when the local backend is unavailable", async () => {
    mocks.getDashboard
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        knowledge_count: 1,
        prompt_count: 3,
        due_count: 2,
        attempt_count: 0,
        reviewed_today: 0,
        current_streak: 0,
        provider: "mock",
        offline: true,
      })

    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    expect(await screen.findByRole("alert")).toHaveTextContent("\u65e0\u6cd5\u8bfb\u53d6\u5b66\u4e60\u8fdb\u5ea6")
    fireEvent.click(screen.getByRole("button", { name: "\u91cd\u8bd5" }))
    expect(await screen.findByText("2 \u4e2a\u5f85\u590d\u4e60")).toBeInTheDocument()
  })

  it("shows the six subject buttons on the home page", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    for (const name of ["语文", "数学", "英语", "物理", "化学", "地理"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }
    expect(screen.getByRole("button", { name: "全部" })).toBeInTheDocument()
  })

  it("dumps a thought without requiring classification", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText("脑暴收集箱"), { target: { value: "半句话的念头" } })
    fireEvent.click(screen.getByRole("button", { name: "暂存" }))
    await waitFor(() => expect(mocks.dumpThought).toHaveBeenCalledWith("半句话的念头"))
    expect(await screen.findByText("已暂存到知识库，稍后可以整理。")).toBeInTheDocument()
  })

  it("offers a way into reading, not only into reviewing", async () => {
    // Every shortcut here leads somewhere in the review loop. Reading is where
    // you go before the material is yours at all, and the page you land on had
    // no door to it.
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    expect(screen.getByRole("link", { name: /阅读/ })).toHaveAttribute("href", "/reading")
  })

  it("shows subject due counts, recent items, and quick links", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    expect(await screen.findByText("2 待复习")).toBeInTheDocument()
    expect(screen.getByText("abandon")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /答疑/ })).toBeInTheDocument()
  })
})

describe("picking up a document again", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.getDashboard.mockResolvedValue({
      knowledge_count: 1,
      prompt_count: 0,
      due_count: 0,
      attempt_count: 0,
      reviewed_today: 0,
      current_streak: 0,
      provider: "mock",
      offline: true,
    })
  })

  function open() {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )
  }

  it("says nothing about reading when no document was left open", () => {
    // An empty card offering to resume nothing is a worse dashboard than no
    // card at all.
    open()

    expect(screen.queryByText("接着读")).not.toBeInTheDocument()
  })

  it("names the document you walked away from", () => {
    // The reason to come back is that a specific thing is unfinished. A
    // generic 阅读 link cannot say that.
    leaveOpen(halfRead)
    open()

    expect(screen.getByText("光合作用")).toBeInTheDocument()
  })

  it("says how much is left, which is what decides whether there is time", () => {
    leaveOpen(halfRead, ["n0-0-p0"])
    open()

    expect(screen.getByText("已读 1 / 2 · 还剩 1 节")).toBeInTheDocument()
  })

  it("leads back into the reader, not just to the reading page in general", () => {
    leaveOpen(halfRead)
    open()

    expect(screen.getByRole("link", { name: /继续读/ })).toHaveAttribute("href", "/reading")
  })

  it("offers nothing when the document left open produced no stops", () => {
    leaveOpen("   ")
    open()

    expect(screen.queryByText("接着读")).not.toBeInTheDocument()
  })
})
