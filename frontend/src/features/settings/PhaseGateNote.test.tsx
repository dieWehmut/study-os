import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PhaseGateNote } from "./PhaseGateNote"

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  listMistakePage: vi.fn(),
}))

vi.mock("@/api/dashboard", () => ({ getDashboard: mocks.getDashboard }))
vi.mock("@/api/mistakes", () => ({ listMistakePage: mocks.listMistakePage }))

function dashboard(overrides: Partial<{ attempt_count: number; knowledge_count: number }> = {}) {
  return {
    knowledge_count: 12,
    prompt_count: 30,
    due_count: 4,
    attempt_count: 9,
    reviewed_today: 2,
    current_streak: 3,
    provider: "mock",
    offline: false,
    subjects_due: {},
    recent_items: [],
    ...overrides,
  }
}

describe("PhaseGateNote", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDashboard.mockResolvedValue(dashboard())
    mocks.listMistakePage.mockResolvedValue({ items: [], count: 3 })
  })

  it("shows how far the 第 4 阶段 gate has come, in its own numbers", async () => {
    // The gate is written in ROADMAP as "enough real records"; a gate nobody can compute
    // is a mood, so the counts that already exist are read and shown.
    render(<PhaseGateNote />)

    const card = (await screen.findByText(/还没到能开工的时候/)).closest("[data-phase-gate='true']")
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain("3 / 20")
    expect(card!.textContent).toContain("9 / 30")
    expect(card!.textContent).toContain("12 / 30")
    expect(card!.textContent).toContain("不会出现")
    // The 订正 count is its own question, not the size of the log.
    expect(mocks.listMistakePage).toHaveBeenCalledWith(expect.objectContaining({ corrected: "yes" }))
  })

  it("says the gate is met when the numbers say so", async () => {
    mocks.getDashboard.mockResolvedValue(dashboard({ attempt_count: 40, knowledge_count: 50 }))
    mocks.listMistakePage.mockResolvedValue({ items: [], count: 25 })

    render(<PhaseGateNote />)

    expect(await screen.findByText(/可以开始做「任务」了/)).toBeInTheDocument()
  })

  it("renders nothing when the numbers cannot be read", async () => {
    mocks.getDashboard.mockRejectedValue(new Error("offline"))

    render(<PhaseGateNote />)

    // Nothing to show, and — the settings page it lives on — nothing broken either.
    expect(document.querySelector("[data-phase-gate='true']")).toBeNull()
  })
})