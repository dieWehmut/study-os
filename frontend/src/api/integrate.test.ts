import { beforeEach, describe, expect, it, vi } from "vitest"

import { createIntegrate, getIntegrateNote, listIntegrateNotes } from "./integrate"

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

describe("integrate API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates an integrated note", async () => {
    mocks.apiRequest.mockResolvedValue({ id: "note-1", title: "运动学", mindmap: { title: "运动学", nodes: [] }, cards: [] })
    const result = await createIntegrate({ subject: "physics", text: "速度描述快慢。" })
    expect(mocks.apiRequest).toHaveBeenCalledWith("/integrate", {
      method: "POST",
      body: JSON.stringify({ subject: "physics", text: "速度描述快慢。" }),
    })
    expect(result.id).toBe("note-1")
  })

  it("lists and gets notes", async () => {
    mocks.apiRequest.mockResolvedValueOnce({ items: [], count: 0 })
    await listIntegrateNotes("math", 20)
    expect(mocks.apiRequest).toHaveBeenCalledWith("/integrate?limit=20&subject=math")

    mocks.apiRequest.mockResolvedValueOnce({ id: "note-1", title: "x", mindmap: { title: "x", nodes: [] }, cards: [] })
    await getIntegrateNote("note-1")
    expect(mocks.apiRequest).toHaveBeenCalledWith("/integrate/note-1")
  })
})
