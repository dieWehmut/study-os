import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Chat from "./Chat"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  sendChatMessage: vi.fn(),
  listChatMessages: vi.fn(),
}))

vi.mock("@/api/chat", () => ({
  sendChatMessage: mocks.sendChatMessage,
  listChatMessages: mocks.listChatMessages,
}))

describe("Chat page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    mocks.listChatMessages.mockResolvedValue({ items: [], count: 0 })
    mocks.sendChatMessage.mockResolvedValue({ message_id: "ai-1", status: "pending" })
  })

  it("sends a message and shows the async pending state", async () => {
    render(<Chat />)

    const input = screen.getByLabelText("发给 AI 的消息")
    fireEvent.change(input, { target: { value: "导数是什么？" } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledWith("all", "导数是什么？"))
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
})
