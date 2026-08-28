import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { KnowledgeItem } from "@/api/types"

import { EnglishMasteryPanel } from "./EnglishMasteryPanel"

const mocks = vi.hoisted(() => ({
  getKnowledgeMastery: vi.fn(),
}))

vi.mock("@/api/knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/knowledge")>()
  return { ...actual, getKnowledgeMastery: mocks.getKnowledgeMastery }
})

const word: KnowledgeItem = {
  id: "word-abandon",
  item_type: "word_sense",
  subject: "english",
  term: "abandon",
  concise_definition: "放弃；遗弃",
  example: "They abandoned the plan after the cost doubled.",
}

describe("EnglishMasteryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getKnowledgeMastery.mockResolvedValue({
      knowledge_item_id: word.id,
      subject: "english",
      dimensions: [
        {
          dimension: "recognition",
          prompt_types: ["en_to_zh"],
          state: "demonstrated",
          evidence_kind: "answer",
          prompt_count: 1,
          attempt_count: 2,
        },
        {
          dimension: "comprehension",
          prompt_types: ["context_cloze"],
          state: "partial",
          evidence_kind: "answer",
          prompt_count: 1,
          attempt_count: 1,
        },
        {
          dimension: "retrieval",
          prompt_types: ["zh_to_en"],
          state: "needs_work",
          evidence_kind: "answer",
          prompt_count: 1,
          attempt_count: 1,
        },
        {
          dimension: "use",
          prompt_types: ["make_sentence"],
          state: "untested",
          evidence_kind: "none",
          prompt_count: 1,
          attempt_count: 0,
        },
      ],
    })
  })

  it("shows four observable abilities with question types and the weakest next check", async () => {
    render(<EnglishMasteryPanel item={word} />)

    expect(await screen.findByRole("heading", { name: "英语掌握度" })).toBeInTheDocument()
    expect(mocks.getKnowledgeMastery).toHaveBeenCalledWith(word.id)
    expect(screen.getByText("识别")).toBeInTheDocument()
    expect(screen.getByText("理解")).toBeInTheDocument()
    expect(screen.getByText("提取")).toBeInTheDocument()
    expect(screen.getByText("运用")).toBeInTheDocument()
    expect(screen.getByText("英文选中文")).toBeInTheDocument()
    expect(screen.getByText("语境辨义")).toBeInTheDocument()
    expect(screen.getByText("中文默写英文")).toBeInTheDocument()
    expect(screen.getByText("造句")).toBeInTheDocument()
    expect(await screen.findByText(/优先检查：中文默写英文/)).toBeInTheDocument()
  })

  it("keeps the question matrix usable when mastery evidence cannot be loaded", async () => {
    mocks.getKnowledgeMastery.mockRejectedValue(new Error("offline"))

    render(<EnglishMasteryPanel item={word} />)

    expect(await screen.findByText("掌握证据暂未同步，仍可按题型逐项检查。")).toBeInTheDocument()
    expect(screen.getByText("英文选中文")).toBeInTheDocument()
    expect(screen.getAllByText("缺少证据")).toHaveLength(4)
  })

  it("does not render or request mastery for another subject", async () => {
    const { container } = render(<EnglishMasteryPanel item={{ ...word, subject: "math" }} />)

    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(mocks.getKnowledgeMastery).not.toHaveBeenCalled())
  })
})
