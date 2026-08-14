import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createEnglishArticle,
  deleteEnglishArticle,
  generateEnglishArticle,
  getEnglishArticle,
  listEnglishArticles,
  normalizeEnglishArticle,
  regenerateEnglishArticle,
} from "./english-articles"

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

const input = {
  original_text: "The market shifted quickly.",
  title: "市场变化",
  original_title: "A Fast Shift",
  author: "A. Writer",
  source_name: "Daily Brief",
  source_url: "https://example.test/story",
  published_at: "2026-08-15",
}

describe("English article API", () => {
  beforeEach(() => vi.clearAllMocks())

  it("lists articles with a bounded limit", async () => {
    mocks.apiRequest.mockResolvedValue({ items: [], count: 0 })

    await listEnglishArticles({ limit: 25 })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/english/articles?limit=25")
  })

  it("sends generation input without inventing missing metadata", async () => {
    mocks.apiRequest.mockResolvedValue({ id: "preview-1", title: "市场变化" })

    await generateEnglishArticle({ original_text: input.original_text, source_name: input.source_name })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/english/articles/generate", {
      method: "POST",
      body: JSON.stringify({ original_text: input.original_text, source_name: input.source_name }),
    })
  })

  it("creates a saved article from the complete preview", async () => {
    mocks.apiRequest.mockResolvedValue({ id: "article-1" })

    await createEnglishArticle({
      ...input,
      content: { title: "市场变化", metadata: {}, sections: [] },
    })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/english/articles", {
      method: "POST",
      body: JSON.stringify({ ...input, content: { title: "市场变化", metadata: {}, sections: [] } }),
    })
  })

  it("strips preview-only fields before saving the canonical content", async () => {
    mocks.apiRequest.mockResolvedValue({ id: "article-1" })

    await createEnglishArticle({
      ...input,
      id: "preview-1",
      section_count: 2,
      created_at: "2026-08-15T10:00:00Z",
      updated_at: "2026-08-15T10:00:00Z",
      markdown: "client markdown must not be trusted",
      content: { title: "市场变化", metadata: {}, sections: [] },
      provider: "mock",
      model: "test-model",
    })

    const [, request] = mocks.apiRequest.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toEqual({
      original_text: input.original_text,
      title: input.title,
      original_title: input.original_title,
      author: input.author,
      source_name: input.source_name,
      source_url: input.source_url,
      published_at: input.published_at,
      content: { title: "市场变化", metadata: {}, sections: [] },
      provider: "mock",
      model: "test-model",
      id: "preview-1",
    })
  })

  it("escapes ids for detail, regeneration, and deletion", async () => {
    mocks.apiRequest.mockResolvedValue({ id: "article/1" })

    await getEnglishArticle("article/1")
    await regenerateEnglishArticle("article/1")
    await deleteEnglishArticle("article/1")

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, "/english/articles/article%2F1")
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, "/english/articles/article%2F1/regenerate", { method: "POST" })
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(3, "/english/articles/article%2F1", { method: "DELETE" })
  })

  it("normalizes structured content and tolerates a legacy content_json string", () => {
    const article = normalizeEnglishArticle({
      id: "article-1",
      title: "市场变化",
      content_json: JSON.stringify({ title: "市场变化", metadata: {}, sections: [] }),
    })

    expect(article.content).toEqual({ title: "市场变化", metadata: {}, sections: [] })
  })
})
