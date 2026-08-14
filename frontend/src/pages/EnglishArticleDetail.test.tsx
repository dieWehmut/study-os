import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import EnglishArticleDetail from "./EnglishArticleDetail"

const mocks = vi.hoisted(() => ({
  getEnglishArticle: vi.fn(),
  regenerateEnglishArticle: vi.fn(),
  deleteEnglishArticle: vi.fn(),
  exportArticlePdf: vi.fn(),
  playPronunciation: vi.fn(),
}))

vi.mock("@/api/english-articles", () => mocks)
vi.mock("@/features/english-articles/export-pdf", () => ({ exportArticlePdf: mocks.exportArticlePdf }))
vi.mock("@/api/audio", () => ({ playPronunciation: mocks.playPronunciation }))

const article = {
  id: "article-1",
  title: "市场变化",
  original_title: "Market Shifts",
  original_text: "The market shifted quickly.",
  author: "A. Writer",
  source_name: "Daily Brief",
  content: {
    title: "市场变化",
    metadata: {
      original_title: "Market Shifts",
      author: "A. Writer",
      source_name: "Daily Brief",
    },
    sections: [
      {
        title: "Opening",
        paragraphs: [{ segments: [{ text: "The market shifted quickly." }], translation: "市场迅速变化。" }],
        vocabulary: [],
      },
      {
        title: "The Turn",
        paragraphs: [{ segments: [{ text: "The plan changed." }], translation: "计划改变了。" }],
        vocabulary: [],
      },
    ],
  },
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.hash}</output>
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/reading/articles/article-1"]}>
      <Routes>
        <Route path="/reading/articles/:id" element={<EnglishArticleDetail />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe("EnglishArticleDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEnglishArticle.mockResolvedValue(article)
    mocks.regenerateEnglishArticle.mockResolvedValue(article)
    mocks.deleteEnglishArticle.mockResolvedValue(undefined)
    mocks.exportArticlePdf.mockResolvedValue(undefined)
    mocks.playPronunciation.mockResolvedValue("file")
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
  })

  it("loads a complete article with a directory and stable section ids", async () => {
    renderDetail()

    expect(await screen.findByRole("heading", { name: "市场变化" })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: /文章目录/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Opening/ })).toHaveAttribute("href", "#section-1-opening")
    expect(document.getElementById("section-1-opening")).toBeInTheDocument()
    expect(document.getElementById("section-2-the-turn")).toBeInTheDocument()
  })

  it("uses history navigation for a directory click and scrolls to the section", async () => {
    renderDetail()
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.click(screen.getByRole("link", { name: /The Turn/ }))

    expect(screen.getByTestId("location")).toHaveTextContent("/reading/articles/article-1#section-2-the-turn")
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it("exports the article root while ignoring the toolbar", async () => {
    renderDetail()
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.click(screen.getByRole("button", { name: /导出 PDF/ }))

    await waitFor(() => expect(mocks.exportArticlePdf).toHaveBeenCalledWith(
      expect.objectContaining({ dataset: expect.anything() }),
      "市场变化",
    ))
    expect(screen.getByRole("toolbar")).toHaveAttribute("data-pdf-ignore")
  })

  it("re-enables PDF export after a failed attempt so it can be retried", async () => {
    mocks.exportArticlePdf
      .mockRejectedValueOnce(new Error("download failed"))
      .mockResolvedValueOnce(undefined)
    renderDetail()
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.click(screen.getByRole("button", { name: /导出 PDF/ }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/PDF 导出失败/))

    fireEvent.click(screen.getByRole("button", { name: /导出 PDF/ }))
    await waitFor(() => expect(mocks.exportArticlePdf).toHaveBeenCalledTimes(2))
  })

  it("keeps the old article visible when regeneration fails", async () => {
    mocks.regenerateEnglishArticle.mockRejectedValue(new Error("offline"))
    renderDetail()
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.click(screen.getByRole("button", { name: /重新生成/ }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/重新生成失败/)
    expect(screen.getByText("市场迅速变化。")).toBeInTheDocument()
  })

  it("shows a not-found state for a 404 and offers the library link", async () => {
    mocks.getEnglishArticle.mockRejectedValue(new ApiError(404, "not found"))
    renderDetail()

    expect(await screen.findByRole("alert")).toHaveTextContent(/文章不存在/)
    expect(screen.getByRole("link", { name: /返回文章库/ })).toHaveAttribute("href", "/reading/articles")
  })
})
