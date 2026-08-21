import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import EnglishCorpora from "./EnglishCorpora"

const mocks = vi.hoisted(() => ({ loadEnglishCorpus: vi.fn() }))

vi.mock("@/features/english-corpora/english-corpora", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/english-corpora/english-corpora")>()
  return { ...original, loadEnglishCorpus: mocks.loadEnglishCorpus }
})

describe("EnglishCorpora page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadEnglishCorpus.mockImplementation((corpus: { id: string }) =>
      Promise.resolve({
        markdown: "# corpus",
        entries: corpus.id === "word-wiki"
          ? [
              { id: "word:abandon", label: "abandon", target: "word-wiki/abandon", kind: "word" },
              { id: "word:ability", label: "ability", target: "word-wiki/ability", kind: "word" },
            ]
          : [
              { id: "mwe:according", label: "according to", target: "according to", kind: "fixed-expression" },
            ],
      }),
    )
  })

  it("loads both built-in corpora and switches between them", async () => {
    render(<MemoryRouter><EnglishCorpora /></MemoryRouter>)

    expect(await screen.findByText("abandon")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: /多词表达与语法家族/ }))
    expect(await screen.findByText("according to")).toBeInTheDocument()
    expect(mocks.loadEnglishCorpus).toHaveBeenCalledTimes(2)
  })

  it("filters the active corpus without calling a backend", async () => {
    render(<MemoryRouter><EnglishCorpora /></MemoryRouter>)
    await screen.findByText("abandon")

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索英语语料" }), {
      target: { value: "ability" },
    })

    expect(screen.getByText("ability")).toBeInTheDocument()
    expect(screen.queryByText("abandon")).not.toBeInTheDocument()
  })
})
