import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import EnglishArticleComposer from "./EnglishArticleComposer"

const mocks = vi.hoisted(() => ({
  generateEnglishArticle: vi.fn(),
  createEnglishArticle: vi.fn(),
}))

vi.mock("@/api/english-articles", () => mocks)

const preview = {
  id: "preview-1",
  title: "市场变化",
  original_title: "A Fast Shift",
  content: {
    title: "市场变化",
    metadata: { original_title: "A Fast Shift" },
    sections: [{
      title: "定义",
      paragraphs: [{ segments: [{ text: "The market shifted quickly.", emphasized: true }], translation: "市场迅速变化。" }],
      vocabulary: [{ term: "shifted", definition: "发生变化", examples: ["The plan shifted."] }],
    }],
  },
}

function renderComposer(onSaved = vi.fn()) {
  return render(
    <MemoryRouter>
      <EnglishArticleComposer onSaved={onSaved} />
    </MemoryRouter>,
  )
}

describe("EnglishArticleComposer", () => {
  beforeEach(() => vi.clearAllMocks())

  it("requires original text before generating", () => {
    renderComposer()

    fireEvent.click(screen.getByRole("button", { name: /生成预览/ }))

    expect(screen.getByRole("alert")).toHaveTextContent(/请输入英文原文/)
    expect(mocks.generateEnglishArticle).not.toHaveBeenCalled()
  })

  it("retains input and metadata when generation fails", async () => {
    mocks.generateEnglishArticle.mockRejectedValue(new Error("offline"))
    renderComposer()

    fireEvent.change(screen.getByLabelText("英文原文"), { target: { value: "The market shifted quickly." } })
    fireEvent.change(screen.getByLabelText("原文标题"), { target: { value: "A Fast Shift" } })
    fireEvent.click(screen.getByRole("button", { name: /生成预览/ }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/生成失败/)
    expect(screen.getByLabelText("英文原文")).toHaveValue("The market shifted quickly.")
    expect(screen.getByLabelText("原文标题")).toHaveValue("A Fast Shift")
  })

  it("renders a preview and saves it through the API", async () => {
    mocks.generateEnglishArticle.mockResolvedValue(preview)
    mocks.createEnglishArticle.mockResolvedValue({ ...preview, id: "article-1" })
    const onSaved = vi.fn()
    renderComposer(onSaved)

    fireEvent.change(screen.getByLabelText("英文原文"), { target: { value: "The market shifted quickly." } })
    fireEvent.click(screen.getByRole("button", { name: /生成预览/ }))

    expect(await screen.findByRole("heading", { name: "市场变化" })).toBeInTheDocument()
    expect(screen.getByText("市场迅速变化。" )).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /保存文章/ }))

    await waitFor(() => expect(mocks.createEnglishArticle).toHaveBeenCalledWith(
      expect.objectContaining({ original_text: "The market shifted quickly." }),
    ))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "article-1" }))
  })

  it("keeps the preview when saving fails so it can be retried", async () => {
    mocks.generateEnglishArticle.mockResolvedValue(preview)
    mocks.createEnglishArticle.mockRejectedValue(new Error("conflict"))
    renderComposer()

    fireEvent.change(screen.getByLabelText("英文原文"), { target: { value: "The market shifted quickly." } })
    fireEvent.click(screen.getByRole("button", { name: /生成预览/ }))
    await screen.findByRole("heading", { name: "市场变化" })
    fireEvent.click(screen.getByRole("button", { name: /保存文章/ }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/保存失败/)
    expect(screen.getByRole("heading", { name: "市场变化" })).toBeInTheDocument()
  })

  it("invalidates the preview when the source input changes", async () => {
    mocks.generateEnglishArticle.mockResolvedValue(preview)
    renderComposer()

    fireEvent.change(screen.getByLabelText("英文原文"), { target: { value: "The market shifted quickly." } })
    fireEvent.click(screen.getByRole("button", { name: /生成预览/ }))
    await screen.findByRole("heading", { name: "市场变化" })

    fireEvent.change(screen.getByLabelText("英文原文"), { target: { value: "A corrected source article." } })

    expect(screen.queryByRole("heading", { name: "市场变化" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /保存文章/ })).not.toBeInTheDocument()
    expect(mocks.createEnglishArticle).not.toHaveBeenCalled()
  })
})
