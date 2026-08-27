import { beforeEach, describe, expect, it, vi } from "vitest"

import { getKnowledgeMastery, listRelatedKnowledge, lookupVocabulary, saveKnowledgeWiki } from "./knowledge"

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

describe("knowledge API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("asks for one item's family by the item, not by a group id nobody was told", () => {
    mocks.apiRequest.mockResolvedValue({ items: [], count: 0, groups: [] })

    void listRelatedKnowledge("k-1")

    expect(mocks.apiRequest).toHaveBeenCalledWith("/knowledge/k-1/related")
  })

  it("escapes an id rather than pasting it into the path", async () => {
    // Item ids come from the database, and one carrying a slash would
    // otherwise silently address a different route.
    mocks.apiRequest.mockResolvedValue({ items: [], count: 0, groups: [] })

    await listRelatedKnowledge("k/1")

    expect(mocks.apiRequest).toHaveBeenCalledWith("/knowledge/k%2F1/related")
  })

  it("reads a family the server has no answer for as empty, not as unknown", async () => {
    // A backend that predates the endpoint, or a payload missing the arrays,
    // must leave the panel showing "no family" rather than a section that
    // never fills.
    mocks.apiRequest.mockResolvedValue({})

    const related = await listRelatedKnowledge("k-1")

    expect(related.items).toEqual([])
    expect(related.groups).toEqual([])
  })

  it("saves wiki markdown with the PUT the route is registered under", async () => {
    // PUT is the verb a full replacement of a resource goes by -- and chi
    // answers 404 for any unregistered method, so the client has to mean it.
    mocks.apiRequest.mockResolvedValue({ id: "k-1" })

    await saveKnowledgeWiki("k-1", "# 光合作用\n\n## 光反应\n")

    expect(mocks.apiRequest).toHaveBeenCalledWith("/knowledge/k-1/wiki", {
      method: "PUT",
      body: JSON.stringify({ detailed_markdown: "# 光合作用\n\n## 光反应\n" }),
    })
  })

  it("escapes an id when saving, just like when reading", async () => {
    mocks.apiRequest.mockResolvedValue({ id: "k/1" })

    await saveKnowledgeWiki("k/1", "# 甲")

    expect(mocks.apiRequest).toHaveBeenCalledWith("/knowledge/k%2F1/wiki", {
      method: "PUT",
      body: JSON.stringify({ detailed_markdown: "# 甲" }),
    })
  })

  it("reads the four-dimensional English mastery projection", async () => {
    mocks.apiRequest.mockResolvedValue({
      knowledge_item_id: "k-1",
      subject: "english",
      dimensions: [],
    })

    await getKnowledgeMastery("k/1")

    expect(mocks.apiRequest).toHaveBeenCalledWith("/knowledge/k%2F1/mastery")
  })

  it("posts a contextual vocabulary lookup with its kind", async () => {
    mocks.apiRequest.mockResolvedValue({ source: "existing", item: { id: "v-1" } })

    await lookupVocabulary({
      term: "at last",
      context: "At last, she answered.",
      kind: "expression",
    })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/knowledge/lookup", {
      method: "POST",
      body: JSON.stringify({
        term: "at last",
        context: "At last, she answered.",
        kind: "expression",
      }),
    })
  })
})
