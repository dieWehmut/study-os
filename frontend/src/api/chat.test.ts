import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  compareKnowledge,
  dumpThought,
  listChatConversations,
  listChatMessages,
  sendChatMessage,
  updateKnowledgeTag,
  uploadChatAttachment,
} from "./chat"

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

describe("chat API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sends a chat message asynchronously", async () => {
    mocks.apiRequest.mockResolvedValue({ session_id: "s1", message_id: "ai-1", status: "pending" })
    const result = await sendChatMessage("math", "导数是什么？", "s1", ["att-1"])
    expect(mocks.apiRequest).toHaveBeenCalledWith("/chat", {
      method: "POST",
      body: JSON.stringify({ subject: "math", message: "导数是什么？", session_id: "s1", attachment_ids: ["att-1"] }),
    })
    expect(result.status).toBe("pending")
  })

  it("lists chat messages with subject filter", async () => {
    mocks.apiRequest.mockResolvedValue({ items: [], count: 0 })
    await listChatMessages("english", "s1", 10)
    expect(mocks.apiRequest).toHaveBeenCalledWith("/chat/messages?limit=10&subject=english&session_id=s1")
  })

  it("lists conversations and uploads attachments", async () => {
    mocks.apiRequest.mockResolvedValueOnce({ items: [], count: 0 })
    await listChatConversations("math", 20)
    expect(mocks.apiRequest).toHaveBeenCalledWith("/chat/conversations?limit=20&subject=math")

    const file = new File(["hello"], "notes.txt", { type: "text/plain" })
    mocks.apiRequest.mockResolvedValueOnce({ id: "att-1", name: "notes.txt", size_bytes: 5, kind: "text" })
    await uploadChatAttachment(file)
    expect(mocks.apiRequest).toHaveBeenCalledWith("/chat/attachments", {
      method: "POST",
      body: expect.any(FormData),
    })
  })

  it("compares knowledge points", async () => {
    mocks.apiRequest.mockResolvedValue({ summary: "对比" })
    const result = await compareKnowledge("physics", "速度", "加速度")
    expect(mocks.apiRequest).toHaveBeenCalledWith("/compare", {
      method: "POST",
      body: JSON.stringify({ subject: "physics", term_a: "速度", term_b: "加速度" }),
    })
    expect(result.summary).toBe("对比")
  })

  it("dumps a thought and updates tags", async () => {
    mocks.apiRequest.mockResolvedValueOnce({ id: "dump-1", term: "念头" })
    await dumpThought("一个念头")
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, "/dump", {
      method: "POST",
      body: JSON.stringify({ text: "一个念头" }),
    })
    mocks.apiRequest.mockResolvedValueOnce({ id: "k1", tags: ["二级结论"] })
    await updateKnowledgeTag("k1", "二级结论", false)
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, "/knowledge/k1/tag", {
      method: "POST",
      body: JSON.stringify({ tag: "二级结论", remove: false }),
    })
  })
})
