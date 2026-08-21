import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  compareKnowledge,
  dumpThought,
  getQARecord,
  listChatConversations,
  listChatMessages,
  saveQARecord,
  sendChatMessage,
  updateKnowledgeTag,
  uploadChatAttachment,
} from "./chat"
import { ApiError } from "./client"

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}))

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>()
  return { ...actual, apiRequest: mocks.apiRequest }
})

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

  it("gets a QA record with an encoded session path", async () => {
    const record = {
      id: "qa-1",
      session_id: "session/with space?",
      subject: "physics",
      original_understanding: "Force means velocity.",
      corrected_model: "Net force means acceleration.",
      mastery_evidence: "Solved a transfer problem.",
      unresolved: "",
      status: "understood" as const,
      created_at: "2026-08-21T00:00:00Z",
      updated_at: "2026-08-21T00:01:00Z",
    }
    mocks.apiRequest.mockResolvedValue(record)

    await expect(getQARecord("session/with space?")).resolves.toEqual(record)
    expect(mocks.apiRequest).toHaveBeenCalledWith("/chat/records/session%2Fwith%20space%3F")
  })

  it("returns null only for an ApiError 404 while loading a QA record", async () => {
    mocks.apiRequest.mockRejectedValueOnce(new ApiError(404, "missing"))
    await expect(getQARecord("missing")).resolves.toBeNull()

    const serverError = new ApiError(500, "failed")
    mocks.apiRequest.mockRejectedValueOnce(serverError)
    await expect(getQARecord("broken")).rejects.toBe(serverError)

    const unrelated404 = Object.assign(new Error("not an ApiError"), { status: 404 })
    mocks.apiRequest.mockRejectedValueOnce(unrelated404)
    await expect(getQARecord("generic")).rejects.toBe(unrelated404)
  })

  it("rejects an empty session id before issuing a QA record request", async () => {
    await expect(getQARecord("   ")).rejects.toThrow("session id is required")
    await expect(saveQARecord("", {
      subject: "physics",
      original_understanding: "",
      corrected_model: "",
      mastery_evidence: "",
      unresolved: "",
    })).rejects.toThrow("session id is required")
    expect(mocks.apiRequest).not.toHaveBeenCalled()
  })

  it("saves a canonical QA record payload to an encoded session path", async () => {
    const input = {
      subject: "physics",
      context_type: "knowledge_item" as const,
      context_id: "knowledge/force",
      original_understanding: "Force means velocity.",
      corrected_model: "Net force determines acceleration.",
      mastery_evidence: "Solved a transfer problem.",
      unresolved: "How does drag change it?",
      status: "follow_up" as const,
    }
    mocks.apiRequest.mockResolvedValue({ id: "qa-1", session_id: "session/qa", ...input })

    await saveQARecord("session/qa", { ...input, extra: "must not leak" } as typeof input)

    expect(mocks.apiRequest).toHaveBeenCalledWith("/chat/records/session%2Fqa", {
      method: "PUT",
      body: JSON.stringify(input),
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
