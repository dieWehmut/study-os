import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Chat from "./Chat"
import { putAskDraft } from "@/lib/ask-draft"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  sendChatMessage: vi.fn(),
  listChatMessages: vi.fn(),
  listChatConversations: vi.fn(),
  uploadChatAttachment: vi.fn(),
}))

vi.mock("@/api/chat", () => ({
  sendChatMessage: mocks.sendChatMessage,
  listChatMessages: mocks.listChatMessages,
  listChatConversations: mocks.listChatConversations,
  uploadChatAttachment: mocks.uploadChatAttachment,
}))

describe("Chat page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    mocks.listChatMessages.mockResolvedValue({ items: [], count: 0 })
    mocks.listChatConversations.mockResolvedValue({ items: [], count: 0 })
    mocks.sendChatMessage.mockResolvedValue({ session_id: "s1", message_id: "ai-1", status: "pending" })
    mocks.uploadChatAttachment.mockResolvedValue({ id: "att-1", name: "notes.txt", size_bytes: 5, kind: "text" })
  })

  it("sends a message and shows the async pending state", async () => {
    render(<Chat />)

    const input = screen.getByLabelText("发给 AI 的消息")
    fireEvent.change(input, { target: { value: "导数是什么？" } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledWith("all", "导数是什么？", undefined, undefined))
    expect(await screen.findByText("AI 正在思考…")).toBeInTheDocument()

    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    expect(await screen.findByText("导数是变化率。", {}, { timeout: 4000 })).toBeInTheDocument()
  })

  it("fills the input from a suggestion chip", async () => {
    useSubjectStore.setState({ subject: "math" })
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: "导数和单调性有什么关系？" }))
    expect(screen.getByLabelText("发给 AI 的消息")).toHaveValue("导数和单调性有什么关系？")
  })

  it("lists conversations and opens one to view history", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [
        {
          session_id: "s1",
          subject: "math",
          message_count: 2,
          last_at: "2026-08-04T00:00:00Z",
          title: "导数",
          preview: "导数是变化率。",
        },
      ],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是啥？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    await waitFor(() => expect(mocks.listChatMessages).toHaveBeenCalledWith("", "s1", 50))
    expect((await screen.findAllByText("导数是变化率。")).length).toBeGreaterThan(0)
  })

  it("uploads an attachment and shows it before sending", async () => {
    render(<Chat />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(["hello"], "notes.txt", { type: "text/plain" })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(mocks.uploadChatAttachment).toHaveBeenCalled())
    expect(await screen.findByText("notes.txt")).toBeInTheDocument()
  })
})

describe("picking up a question left by 阅读", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useSubjectStore.setState({ subject: "all" })
    mocks.listChatMessages.mockResolvedValue({ items: [], count: 0 })
    mocks.listChatConversations.mockResolvedValue({ items: [], count: 0 })
  })

  it("finds the question already written, rather than asking you to retype it", () => {
    // Retyping the sections you just flagged is the cost that stops 去问 from
    // being the obvious thing to do next.
    putAskDraft("这两节我没看懂")

    render(<Chat />)

    expect(screen.getByLabelText("发给 AI 的消息")).toHaveValue("这两节我没看懂")
  })

  it("does not hand the same question over twice", () => {
    // The draft is a handoff between two pages, not a store. One that survived
    // being read would turn up on an unrelated visit weeks later.
    putAskDraft("这两节我没看懂")
    render(<Chat />).unmount()

    render(<Chat />)

    expect(screen.getByLabelText("发给 AI 的消息")).toHaveValue("")
  })

  it("leaves the box empty when you came here on your own", () => {
    render(<Chat />)

    expect(screen.getByLabelText("发给 AI 的消息")).toHaveValue("")
  })
})
