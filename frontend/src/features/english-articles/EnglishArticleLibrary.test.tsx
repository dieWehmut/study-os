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
})
