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
  saveTextFile: vi.fn(),
  // The Pages build keeps the route inside the hash; the page composes the copied
  // link differently there, and that branch is worth pinning.
  routerMode: vi.fn((): "browser" | "hash" => "browser"),
}))

vi.mock("@/api/english-articles", () => mocks)
vi.mock("@/features/english-articles/export-pdf", () => ({ exportArticlePdf: mocks.exportArticlePdf }))
vi.mock("@/api/audio", () => ({ playPronunciation: mocks.playPronunciation }))
vi.mock("@/lib/runtime", () => ({ routerMode: mocks.routerMode }))
// The file itself is the browser's job; what this page decides is the text and the
// name, which is what the test asserts.
vi.mock("@/lib/download", () => ({ saveTextFile: mocks.saveTextFile }))

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
    mocks.routerMode.mockReturnValue("browser")
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

  it("collects the article's glossary above the text, once per word", async () => {
    // The entries are already on the sections, but one at a time inside the text: a
    // reader preparing for the article wants the whole list first.
    mocks.getEnglishArticle.mockResolvedValue({
      ...article,
      content: {
        ...article.content,
        sections: [
          {
            ...article.content.sections[0]!,
            vocabulary: [
              { term: "shifted", definition: "发生变化", british_phonetic: "/ˈʃɪftɪd/", part_of_speech: "v." },
              { term: "plan", definition: "计划" },
            ],
          },
          {
            ...article.content.sections[1]!,
            // The same word again: the list is a study aid, so it says it once.
            vocabulary: [{ term: "Shifted", definition: "发生变化（重复）" }],
          },
        ],
      },
    })
    renderDetail()

    await screen.findByRole("heading", { name: "市场变化" })
    const card = document.querySelector("[data-article-vocabulary='true']")
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain("本篇生词（2）")
    expect(card!.textContent).toContain("shifted")
    expect(card!.textContent).toContain("变化")
    expect(card!.textContent).not.toContain("重复")
  })

  it("copies the address of one section", async () => {
    // The anchors have been there for a while; this is what makes one usable away
    // from the page.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    renderDetail()
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.click(screen.getByRole("button", { name: "复制「The Turn」的链接" }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0][0]).toContain("#section-2-the-turn")
    expect(writeText.mock.calls[0][0]).toContain("/reading/articles/article-1")
  })

  it("keeps the route inside the hash when the app is running from the Pages build", async () => {
    // HashRouter keeps the route after the #, so a link that puts the path first
    // lands on the site root: the section would be gone even though the anchor is
    // right.
    mocks.routerMode.mockReturnValue("hash")
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    renderDetail()
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.click(screen.getByRole("button", { name: "复制「The Turn」的链接" }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0][0]).toMatch(/#\/reading\/articles\/article-1#section-2-the-turn$/)
  })

  it("says so when the browser refuses the clipboard instead of staying quiet", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    })
    renderDetail()
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.click(screen.getByRole("button", { name: "复制「The Turn」的链接" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("复制链接失败")
  })

  it("exports the article as Markdown, using the stored text rather than the page", async () => {
    mocks.getEnglishArticle.mockResolvedValue({ ...article, markdown: "# 市场变化\n\nThe market shifted quickly.\n" })
    renderDetail()
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.click(screen.getByRole("button", { name: "导出 Markdown" }))

    expect(mocks.saveTextFile).toHaveBeenCalledWith(
      "# 市场变化\n\nThe market shifted quickly.\n",
      "市场变化-article-1.md",
      expect.stringContaining("markdown"),
    )
  })

  it("still writes a usable file when the article has no stored Markdown", async () => {
    mocks.getEnglishArticle.mockResolvedValue({ ...article, markdown: "" })
    renderDetail()
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.click(screen.getByRole("button", { name: "导出 Markdown" }))

    expect(mocks.saveTextFile).toHaveBeenCalledWith("# 市场变化\n", "市场变化-article-1.md", expect.any(String))
  })

  it("uses history navigation for a directory click and scrolls to the section", async () => {
    renderDetail()
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.click(screen.getByRole("link", { name: /The Turn/ }))

    // These land after the router has taken the click, and the scroll rides on it.
    // The wait is 5s and each assertion carries a label: this is the one test in the
    // suite that goes red only while the machine is loaded, and the label is what
    // finally said which one. It reported:
    //   the click did not reach the router: received ...#section-1-opening
    // so the click did arrive, and the hook's "no section in the address, so show
    // the first one" jump then ran late and undid it. That jump no longer fires
    // once a reader has chosen (see chosenByReader), which the hook cannot pin in
    // jsdom -- the window needs an unflushed passive effect -- so this test is the
    // place the mechanism stays written down.
    await waitFor(
      () => expect(screen.getByTestId("location"), "the click did not reach the router")
        .toHaveTextContent("/reading/articles/article-1#section-2-the-turn"),
      { timeout: 5000 },
    )
    await waitFor(
      () => expect(HTMLElement.prototype.scrollIntoView, "the section was never scrolled to")
        .toHaveBeenCalled(),
      { timeout: 5000 },
    )
    await waitFor(
      () => expect(screen.getByTestId("location")).toHaveTextContent("/reading/articles/article-1#section-2-the-turn"),
      { timeout: 5000 },
    )
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled(), { timeout: 5000 })
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
