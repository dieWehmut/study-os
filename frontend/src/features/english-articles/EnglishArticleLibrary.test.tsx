import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import EnglishArticleLibrary from "./EnglishArticleLibrary"

const mocks = vi.hoisted(() => ({
  listEnglishArticles: vi.fn(),
  deleteEnglishArticle: vi.fn(),
}))

vi.mock("@/api/english-articles", () => mocks)

function renderLibrary() {
  return render(
    <MemoryRouter>
      <EnglishArticleLibrary />
    </MemoryRouter>,
  )
}

describe("EnglishArticleLibrary", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows a useful empty state and add link", async () => {
    mocks.listEnglishArticles.mockResolvedValue({ items: [], count: 0 })

    renderLibrary()

    expect(await screen.findByText(/还没有英语时文/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /添加文章/ })).toHaveAttribute("href", "/reading/articles/new")
  })

  it("renders article metadata and links to its stable detail URL", async () => {
    mocks.listEnglishArticles.mockResolvedValue({
      items: [{
        id: "article-1",
        title: "市场变化",
        original_title: "A Fast Shift",
        author: "A. Writer",
        source_name: "Daily Brief",
        published_at: "2026-08-15",
        updated_at: "2026-08-15T10:00:00Z",
      }],
      count: 1,
    })

    renderLibrary()

    expect(await screen.findByRole("link", { name: /市场变化/ })).toHaveAttribute("href", "/reading/articles/article-1")
    expect(screen.getByText(/A\. Writer/)).toBeInTheDocument()
    expect(screen.getByText(/2026-08-15/)).toBeInTheDocument()
  })

  it("allows deleting a row and refreshes its local list", async () => {
    mocks.listEnglishArticles.mockResolvedValue({
      items: [{ id: "article-1", title: "市场变化", updated_at: "2026-08-15T10:00:00Z" }],
      count: 1,
    })
    mocks.deleteEnglishArticle.mockResolvedValue(undefined)

    renderLibrary()
    await screen.findByRole("link", { name: /市场变化/ })
    fireEvent.click(screen.getByRole("button", { name: /删除.*市场变化/ }))

    await waitFor(() => expect(mocks.deleteEnglishArticle).toHaveBeenCalledWith("article-1"))
    expect(screen.queryByRole("link", { name: /市场变化/ })).not.toBeInTheDocument()
  })

  it("keeps an error visible when loading fails", async () => {
    mocks.listEnglishArticles.mockRejectedValue(new Error("offline"))

    renderLibrary()

    expect(await screen.findByRole("alert")).toHaveTextContent(/无法加载英语时文/)
  })

  it("asks for one row too many, and says so when the library is longer", async () => {
    // The list answers a page rather than a total, so the extra row is the only
    // way to tell "these are all of them" from "these are the newest hundred".
    const items = Array.from({ length: 101 }, (_, index) => ({ id: `a-${index}`, title: `第 ${index} 篇` }))
    mocks.listEnglishArticles.mockResolvedValue({ items, count: items.length })

    renderLibrary()

    expect(await screen.findByText(/显示最近 100 篇/)).toBeInTheDocument()
    expect(screen.getByText(/更早的时文还在库里/)).toBeInTheDocument()
    // The hundred-and-first row was only there to be counted.
    expect(screen.queryByRole("link", { name: /第 100 篇/ })).not.toBeInTheDocument()
    expect(mocks.listEnglishArticles).toHaveBeenCalledWith({ limit: 101 })
  }, 20_000)

  it("sorts by how many words an article glosses, without re-asking the server", async () => {
    // The count is already on every row, so ordering by it answers "what can I read
    // tonight?" for free -- and it is a view, not another request.
    mocks.listEnglishArticles.mockResolvedValue({
      items: [
        { id: "a-1", title: "生词少的一篇", vocabulary_count: 1, updated_at: "2026-08-22T00:00:00Z" },
        { id: "a-2", title: "生词多的一篇", vocabulary_count: 9, updated_at: "2026-08-20T00:00:00Z" },
      ],
      count: 2,
    })

    renderLibrary()
    await screen.findByText("生词少的一篇")
    const callsBefore = mocks.listEnglishArticles.mock.calls.length

    fireEvent.click(document.querySelector("[data-article-sort='vocabulary']")!)

    const titles = screen.getAllByRole("link", { name: /一篇/ }).map((link) => link.textContent)
    expect(titles[0]).toBe("生词多的一篇")
    expect(screen.getByText(/生词多的在前/)).toBeInTheDocument()
    expect(mocks.listEnglishArticles.mock.calls.length).toBe(callsBefore)
  })

  it("claims the whole library only when it really has it", async () => {
    mocks.listEnglishArticles.mockResolvedValue({ items: [{ id: "a-1", title: "唯一一篇" }], count: 1 })

    renderLibrary()

    expect(await screen.findByText(/共 1 篇/)).toBeInTheDocument()
  })

  it("says how many words an article glosses before it is opened", async () => {
    // The glossary is how hard the article will be, and the list is where the choice
    // is made. Silence for none, and for a content that could not be read (-1): a
    // number is only printed when there is one.
    mocks.listEnglishArticles.mockResolvedValue({
      items: [
        { id: "a-1", title: "有生词的一篇", vocabulary_count: 4, updated_at: "2026-08-20T00:00:00Z" },
        { id: "a-2", title: "没有生词的一篇", vocabulary_count: 0, updated_at: "2026-08-20T00:00:00Z" },
        { id: "a-3", title: "读不了内容的一篇", vocabulary_count: -1, updated_at: "2026-08-20T00:00:00Z" },
      ],
      count: 3,
    })

    renderLibrary()

    expect(await screen.findByText("4 个生词")).toBeInTheDocument()
    expect(screen.queryByText("0 个生词")).not.toBeInTheDocument()
    expect(screen.queryByText(/个生词/)).toHaveTextContent("4 个生词")
  })
})
