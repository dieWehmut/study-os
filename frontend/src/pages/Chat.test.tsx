import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { QARecord } from "@/api/chat"
import { ApiError } from "@/api/client"
import Chat from "./Chat"
import { putAskDraft } from "@/lib/ask-draft"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  sendChatMessage: vi.fn(),
  listChatMessages: vi.fn(),
  listChatConversations: vi.fn(),
  uploadChatAttachment: vi.fn(),
  getQARecord: vi.fn(),
  saveQARecord: vi.fn(),
  dumpThought: vi.fn(),
  listKnowledge: vi.fn(),
  getKnowledge: vi.fn(),
  scheduleKnowledge: vi.fn(),
  listMistakes: vi.fn(),
  listLessons: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const savedRecord: QARecord = {
  id: "qa-1",
  session_id: "s1",
  subject: "math",
  context_type: "question",
  context_id: "question-1",
  original_understanding: "我把导数当成函数值。",
  corrected_model: "导数描述变化率。",
  mastery_evidence: "能解释切线斜率。",
  unresolved: "复合函数求导还不熟。",
  status: "follow_up",
  created_at: "2026-08-04T00:00:02Z",
  updated_at: "2026-08-04T00:00:02Z",
}

vi.mock("@/api/chat", () => ({
  sendChatMessage: mocks.sendChatMessage,
  listChatMessages: mocks.listChatMessages,
  listChatConversations: mocks.listChatConversations,
  uploadChatAttachment: mocks.uploadChatAttachment,
  getQARecord: mocks.getQARecord,
  saveQARecord: mocks.saveQARecord,
  dumpThought: mocks.dumpThought,
}))

vi.mock("@/api/knowledge", () => ({
  listKnowledge: mocks.listKnowledge,
  getKnowledge: mocks.getKnowledge,
  scheduleKnowledge: mocks.scheduleKnowledge,
}))
vi.mock("@/api/mistakes", () => ({ listMistakes: mocks.listMistakes }))
vi.mock("@/api/lessons", () => ({ listLessons: mocks.listLessons }))

describe("Chat page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubjectStore.setState({ subject: "all" })
    mocks.listChatMessages.mockResolvedValue({ items: [], count: 0 })
    mocks.listChatConversations.mockResolvedValue({ items: [], count: 0 })
    mocks.getQARecord.mockResolvedValue(null)
    mocks.saveQARecord.mockResolvedValue(null)
    mocks.listKnowledge.mockResolvedValue({ items: [], count: 0 })
    mocks.getKnowledge.mockResolvedValue({
      id: "k-1",
      item_type: "brain_dump",
      term: "导数与变化率",
      concise_definition: "导数描述变化率。",
      scheduled: false,
    })
    mocks.scheduleKnowledge.mockResolvedValue({ status: "scheduled", knowledge_id: "k-1", prompt_count: 1 })
    mocks.dumpThought.mockResolvedValue({ id: "dump-1", term: "导数是什么？" })
    mocks.listMistakes.mockResolvedValue([])
    mocks.listLessons.mockResolvedValue({ items: [], count: 0 })
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
    expect((await screen.findAllByText("导数是变化率。", {}, { timeout: 4000 })).length).toBeGreaterThan(0)
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

  it("finds an older conversation by something said inside it", async () => {
    // The list is the newest 50 conversations, so a 问答 from last week is not
    // merely hard to find here -- it is not in the answer at all.
    mocks.listChatConversations.mockImplementation((_subject: string, _limit: number, query = "") =>
      Promise.resolve(
        query
          ? {
              items: [{ session_id: "s9", subject: "math", message_count: 2, last_at: "2026-08-01T00:00:00Z", title: "极值", preview: "先求导，再令它等于 0。" }],
              count: 1,
            }
          : {
              items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
              count: 1,
            },
      ),
    )
    render(<Chat />)
    await screen.findByRole("button", { name: /导数/ })

    fireEvent.change(screen.getByLabelText("搜索对话内容"), { target: { value: "极值" } })
    fireEvent.click(screen.getByRole("button", { name: "搜索对话" }))

    await waitFor(() => expect(mocks.listChatConversations).toHaveBeenCalledWith("", 50, "极值"))
    expect(await screen.findByRole("button", { name: /极值/ })).toBeInTheDocument()
    expect(screen.getByText(/只显示提到「极值」的对话/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "清除" }))

    await waitFor(() => expect(mocks.listChatConversations).toHaveBeenCalledWith("", 50, ""))
    expect(await screen.findByRole("button", { name: /导数/ })).toBeInTheDocument()
  })

  it("loads conversations past the newest page", async () => {
    // The sidebar holds the newest 50 and now knows how many there are, so an
    // older 问答 is reachable by browsing, not only by remembering a word in it.
    const conversation = (id: string, title: string) => ({
      session_id: id,
      subject: "math",
      message_count: 2,
      last_at: "2026-08-04T00:00:00Z",
      title,
      preview: title,
    })
    mocks.listChatConversations.mockImplementation((_subject: string, _limit: number, _query: string, offset = 0) =>
      Promise.resolve(
        offset === 0
          ? { items: [conversation("s1", "导数"), conversation("s2", "积分")], count: 3 }
          : { items: [conversation("s3", "极值")], count: 3 },
      ),
    )
    render(<Chat />)
    await screen.findByRole("button", { name: /导数/ })

    fireEvent.click(screen.getByRole("button", { name: "加载更多（还有 1 段）" }))

    await waitFor(() => expect(mocks.listChatConversations).toHaveBeenCalledWith("", 50, "", 2))
    expect(await screen.findByRole("button", { name: /极值/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /加载更多/ })).not.toBeInTheDocument()
  })

  it("uploads an attachment and shows it before sending", async () => {
    render(<Chat />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(["hello"], "notes.txt", { type: "text/plain" })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(mocks.uploadChatAttachment).toHaveBeenCalled())
    expect(await screen.findByText("notes.txt")).toBeInTheDocument()
  })

  it("says why the server refused an attachment instead of guessing the size", async () => {
    // The old copy told everyone to check the size of their file; the server knows
    // whether that was the reason.
    mocks.uploadChatAttachment.mockRejectedValue(new ApiError(400, "附件不能超过 5MB"))
    render(<Chat />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["hello"], "big.zip")] } })

    expect(await screen.findByRole("alert")).toHaveTextContent("附件上传失败：附件不能超过 5MB")
  })

  it("states the attachment rule before the reader has to be refused by it", () => {
    render(<Chat />)

    expect(screen.getByText(/附件单个不超过 5MB/)).toBeInTheDocument()
  })

  it("keeps upload and send controls inside the composer bottom-right action area", () => {
    render(<Chat />)

    const composer = screen.getByRole("group", { name: "消息编辑器" })
    const actions = within(composer).getByRole("group", { name: "消息操作" })
    const upload = within(actions).getByRole("button", { name: "上传附件" })
    const send = within(actions).getByRole("button", { name: "发送" })

    expect(composer).toContainElement(screen.getByLabelText("发给 AI 的消息"))
    expect(actions).toHaveClass("absolute", "right-3", "bottom-3")
    expect(upload.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("shows the evidence panel only after a completed assistant reply and prefills the latest turn", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    expect(await screen.findByText("学习记录")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "原本理解" })).toHaveValue("导数是什么？")
    expect(screen.getByRole("textbox", { name: "纠正后的模型" })).toHaveValue("导数是变化率。")
  })

  it("files the answer as a card, with the question as the prompt", async () => {
    // An answer that never comes back is a conversation, not learning. The
    // question leads so the library names the card by it -- an answer usually
    // opens with 因为, which is a terrible thing to be asked.
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.dumpThought.mockResolvedValueOnce({ id: "dump-1", term: "导数是什么？" })
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    fireEvent.click(await screen.findByRole("button", { name: "收进知识库" }))

    await waitFor(() => expect(mocks.dumpThought).toHaveBeenCalledTimes(1))
    expect(mocks.dumpThought.mock.calls[0][0]).toBe("导数是什么？\n\n导数是变化率。")
    // Filed *and* queued: the point is that it comes back tomorrow.
    await waitFor(() => expect(mocks.scheduleKnowledge).toHaveBeenCalledWith("dump-1"))
    expect(await screen.findByRole("button", { name: /已收进知识库/ })).toBeDisabled()
    expect(screen.getByRole("link", { name: "去记忆" })).toHaveAttribute("href", "/memory")
  })

  it("says so when the answer cannot be filed", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.dumpThought.mockRejectedValueOnce(new ApiError(500, "保存念头失败"))
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    fireEvent.click(await screen.findByRole("button", { name: "收进知识库" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("收进知识库失败：保存念头失败")
    // Still clickable, because nothing was saved.
    expect(screen.getByRole("button", { name: "收进知识库" })).toBeEnabled()
  })

  it("does not show the evidence panel for a pending or failed reply", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "", status: "pending", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    await waitFor(() => expect(mocks.listChatMessages).toHaveBeenCalledWith("", "s1", 50))
    expect(screen.queryByText("学习记录")).not.toBeInTheDocument()
  })

  it("restores an existing evidence record instead of replacing it with the latest answer", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.getQARecord.mockResolvedValueOnce(savedRecord)
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))

    await waitFor(() => expect(screen.getByRole("textbox", { name: "原本理解" })).toHaveValue(savedRecord.original_understanding))
    expect(screen.getByRole("textbox", { name: "纠正后的模型" })).toHaveValue(savedRecord.corrected_model)
    expect(screen.getByRole("combobox", { name: "状态" })).toHaveValue("follow_up")
  })

  it("maps a listed mistake to its stable question id when saving", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.listMistakes.mockResolvedValueOnce([{
      id: "attempt-1",
      questionId: "question-1",
      subject: "math",
      question: "求函数导数",
      cause: "method",
      createdAt: "2026-08-04T00:00:00Z",
    }])
    mocks.saveQARecord.mockResolvedValueOnce(savedRecord)
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    const context = await screen.findByRole("combobox", { name: "关联对象" })
    await screen.findByRole("option", { name: "错题：求函数导数" })
    fireEvent.change(context, { target: { value: JSON.stringify(["question", "question-1"]) } })
    const save = screen.getByRole("button", { name: "保存记录" })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)

    await waitFor(() => expect(mocks.saveQARecord).toHaveBeenCalledWith("s1", expect.objectContaining({
      context_type: "question",
      context_id: "question-1",
    })))
  })

  it("keeps the edited draft visible when saving the evidence record fails", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.saveQARecord.mockRejectedValueOnce(new Error("offline"))
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    const original = await screen.findByRole("textbox", { name: "原本理解" })
    fireEvent.change(original, { target: { value: "我把导数当成函数值了" } })
    const save = screen.getByRole("button", { name: "保存记录" })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("保存学习记录失败"))
    expect(original).toHaveValue("我把导数当成函数值了")
  })

  it("returns a saved record's knowledge point to the review queue only when asked", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.getQARecord.mockResolvedValueOnce({ ...savedRecord, context_type: "knowledge_item", context_id: "k-1" })
    mocks.listKnowledge.mockResolvedValueOnce({
      count: 1,
      items: [{ id: "k-1", item_type: "brain_dump", term: "导数与变化率", concise_definition: "导数描述变化率。" }],
      scheduled_ids: [],
    })
    mocks.scheduleKnowledge.mockResolvedValueOnce({ status: "scheduled", knowledge_id: "k-1", prompt_count: 3 })
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    const queue = await screen.findByRole("button", { name: "排进复习" })

    // Reading the record is not consent to schedule a card from it.
    expect(mocks.scheduleKnowledge).not.toHaveBeenCalled()
    expect(screen.getByRole("region", { name: "回流到复习计划" })).toHaveTextContent("导数与变化率")

    fireEvent.click(queue)

    await waitFor(() => expect(mocks.scheduleKnowledge).toHaveBeenCalledWith("k-1"))
    const queued = within(await screen.findByRole("region", { name: "回流到复习计划" }))
    await waitFor(() => expect(queued.getByRole("status")).toHaveTextContent("已排进复习 · 3 张卡"))
    expect(screen.queryByRole("button", { name: "排进复习" })).not.toBeInTheDocument()
  })

  it("does not claim a fresh schedule for a point the plan already held", async () => {
    // The linked point can be queued without this panel knowing: it may sit
    // outside the page of knowledge items that answered 复习状态, or another
    // device may have scheduled it. The server says which of the two happened,
    // and "已排进复习 · 2 张卡" for cards it did not write is a lie.
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.getQARecord.mockResolvedValueOnce({ ...savedRecord, context_type: "knowledge_item", context_id: "k-1" })
    mocks.listKnowledge.mockResolvedValueOnce({
      count: 1,
      items: [{ id: "k-1", item_type: "brain_dump", term: "导数与变化率", concise_definition: "导数描述变化率。" }],
      scheduled_ids: [],
    })
    mocks.scheduleKnowledge.mockResolvedValueOnce({ status: "already_scheduled", knowledge_id: "k-1", prompt_count: 2 })
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    fireEvent.click(await screen.findByRole("button", { name: "排进复习" }))

    const queued = within(await screen.findByRole("region", { name: "回流到复习计划" }))
    await waitFor(() => expect(queued.getByRole("status")).toHaveTextContent("已经在复习计划里"))
    expect(queued.queryByText(/已排进复习/)).not.toBeInTheDocument()
  })

  it("leaves a record linked to a 错题 without a queue button", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.getQARecord.mockResolvedValueOnce(savedRecord)
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    await waitFor(() => expect(screen.getByRole("textbox", { name: "原本理解" })).toHaveValue(savedRecord.original_understanding))

    // A 错题 link has no review card behind it; the queue belongs on Practice.
    expect(screen.queryByRole("region", { name: "回流到复习计划" })).not.toBeInTheDocument()
    // Nothing to ask about: the record points at a 错题, not a knowledge point.
    expect(mocks.getKnowledge).not.toHaveBeenCalled()
  })

  it("finds a knowledge point the first page of 关联对象 never had", async () => {
    // The options are one page of the newest items, so an older word is not
    // merely hard to find -- it cannot be linked at all. Searching asks the
    // server by text and the answer joins the same list.
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.listKnowledge.mockImplementation((options?: { query?: string }) =>
      Promise.resolve(
        options?.query
          ? {
              count: 1,
              items: [{ id: "k-77", item_type: "brain_dump", term: "动能定理", concise_definition: "只对合外力做功成立。" }],
              scheduled_ids: [],
            }
          : {
              count: 1,
              items: [{ id: "k-1", item_type: "brain_dump", term: "导数与变化率", concise_definition: "导数描述变化率。" }],
              scheduled_ids: [],
            },
      ),
    )
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    const box = await screen.findByLabelText("搜索关联对象")
    // The panel disables the search until the first page of 关联对象 has arrived,
    // so typing before it does is typing into a disabled input: the click is
    // dropped and the search never happens. That is what this test used to fail
    // on under load, once every ten full runs -- waiting for the control to be
    // usable is what a reader does anyway.
    await waitFor(() => expect(box).toBeEnabled())
    fireEvent.change(box, { target: { value: "动能" } })
    const search = screen.getByRole("button", { name: "搜索" })
    await waitFor(() => expect(search).toBeEnabled())
    fireEvent.click(search)

    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ query: "动能" })))
    expect(await screen.findByRole("option", { name: "知识点：动能定理" })).toBeInTheDocument()
    // By its text, not by role: this panel has two other role=status regions
    // (the empty note and the 回流 queue), so "status" alone is ambiguous enough
    // that the full suite failed here under load and passed on its own.
    expect(await screen.findByText(/找到 1 条/)).toBeInTheDocument()
    // A native select opens at the top, so the answer has to be at the top:
    // appending it behind three hundred loaded options is the same as hiding it.
    const options = within(screen.getByLabelText("关联对象")).getAllByRole("option")
    expect(options[1]).toHaveTextContent("知识点：动能定理")
  })

  // Three pages answer this search, so the wait runs through three promises and
// their renders. Every load-sensitive assertion in this suite waits 5s for that
// reason; this test was on the 1s default, which is the one wait here that a busy
// machine can still outrun. That is a guess at why one full run went red -- the
// failure's detail was lost before it could say -- so this removes an
// inconsistency rather than claiming a fix.
const SEARCH_WAIT = { timeout: 5000 }

it("looks in mistakes and courses too, not only the knowledge library", async () => {
    // The select offers 知识点 / 错题 / 课程. A search that only ever answered
    // for the first of the three made the others look unfindable, which is the
    // one thing a search box must not do.
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.listMistakes.mockImplementation((options?: { query?: string }) =>
      Promise.resolve(
        options?.query
          ? [{ id: "attempt-9", questionId: "question-9", subject: "math", question: "求函数极值", cause: "method", createdAt: "2026-08-04T00:00:00Z" }]
          : [],
      ),
    )
    mocks.listLessons.mockImplementation((options?: { query?: string }) =>
      Promise.resolve(
        options?.query
          ? { items: [{ id: "lesson-9", title: "极值一节课", subject: "math", status: "draft" }], count: 1 }
          : { items: [], count: 0 },
      ),
    )
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    const box = await screen.findByLabelText("搜索关联对象")
    fireEvent.change(box, { target: { value: "极值" } })
    // The search button enables on the next render (it is disabled while the box is
    // empty, and while a search is in flight). Clicking it before that render lands on
    // a disabled button and is silently dropped -- which is exactly how this test
    // failed once every dozen full runs.
    const searchButton = screen.getByRole("button", { name: "搜索" })
    await waitFor(() => expect(searchButton).toBeEnabled())
    fireEvent.click(searchButton)

    expect(await screen.findByRole("option", { name: "错题：求函数极值" }, SEARCH_WAIT)).toBeInTheDocument()
    expect(await screen.findByRole("option", { name: "课程：极值一节课" }, SEARCH_WAIT)).toBeInTheDocument()
    expect(await screen.findByText(/找到 2 条/, undefined, SEARCH_WAIT)).toBeInTheDocument()
    const options = within(screen.getByLabelText("关联对象")).getAllByRole("option")
    expect(options[1]).toHaveTextContent("错题：求函数极值")
    expect(options[2]).toHaveTextContent("课程：极值一节课")
  })

  it("names a linked point the 关联对象 page no longer carries", async () => {
    // The list is capped and filtered by the subject chip, so a record saved
    // earlier can point at an item that is not on it. Guessing from the page
    // loses the name and offers 排进复习 for something already queued.
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.getQARecord.mockResolvedValueOnce({ ...savedRecord, context_type: "knowledge_item", context_id: "k-9" })
    mocks.listKnowledge.mockResolvedValueOnce({
      count: 1,
      items: [{ id: "k-1", item_type: "brain_dump", term: "导数与变化率", concise_definition: "导数描述变化率。" }],
      scheduled_ids: [],
    })
    mocks.getKnowledge.mockResolvedValueOnce({
      id: "k-9",
      item_type: "brain_dump",
      term: "动能定理",
      concise_definition: "只对合外力做功成立。",
      scheduled: true,
    })
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))

    const flowBack = within(await screen.findByRole("region", { name: "回流到复习计划" }))
    await waitFor(() => expect(mocks.getKnowledge).toHaveBeenCalledWith("k-9"))
    await waitFor(() => expect(flowBack.getByRole("status")).toHaveTextContent("已经在复习计划里"))
    expect(flowBack.queryByRole("button", { name: "排进复习" })).not.toBeInTheDocument()
  })

  it("says a knowledge point is already queued instead of offering it again", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.getQARecord.mockResolvedValueOnce({ ...savedRecord, context_type: "knowledge_item", context_id: "k-1" })
    mocks.listKnowledge.mockResolvedValueOnce({
      count: 1,
      items: [{ id: "k-1", item_type: "brain_dump", term: "导数与变化率", concise_definition: "导数描述变化率。" }],
      scheduled_ids: ["k-1"],
    })
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))

    const region = await screen.findByRole("region", { name: "回流到复习计划" })
    await waitFor(() => expect(within(region).getByRole("status")).toHaveTextContent("已经在复习计划里"))
    expect(screen.queryByRole("button", { name: "排进复习" })).not.toBeInTheDocument()
  })

  it("keeps the queue button retryable when the request fails", async () => {
    mocks.listChatConversations.mockResolvedValueOnce({
      items: [{ session_id: "s1", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "导数", preview: "导数是变化率。" }],
      count: 1,
    })
    mocks.listChatMessages.mockResolvedValueOnce({
      items: [
        { id: "u1", role: "user", content: "导数是什么？", status: "done", created_at: "2026-08-04T00:00:00Z" },
        { id: "a1", role: "assistant", content: "导数是变化率。", status: "done", created_at: "2026-08-04T00:00:01Z" },
      ],
      count: 2,
    })
    mocks.getQARecord.mockResolvedValueOnce({ ...savedRecord, context_type: "knowledge_item", context_id: "k-1" })
    mocks.scheduleKnowledge.mockRejectedValueOnce(new Error("offline"))
    render(<Chat />)

    fireEvent.click(await screen.findByRole("button", { name: /导数/ }))
    fireEvent.click(await screen.findByRole("button", { name: "排进复习" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("排进复习失败，请重试。")
    expect(screen.getByRole("button", { name: "排进复习" })).toBeEnabled()
  })

  it("ignores a send response after the learner starts a new conversation", async () => {
    const pendingSend = deferred<{ session_id: string; message_id: string; status: string }>()
    mocks.sendChatMessage.mockReturnValueOnce(pendingSend.promise)
    render(<Chat />)

    fireEvent.change(screen.getByLabelText("发给 AI 的消息"), { target: { value: "旧问题" } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole("button", { name: "新对话" }))

    await act(async () => pendingSend.resolve({ session_id: "old-session", message_id: "old-answer", status: "pending" }))

    expect(mocks.listChatMessages).not.toHaveBeenCalledWith("", "old-session", 50)
    expect(screen.queryByText("旧问题")).not.toBeInTheDocument()
  })

  it("ignores an in-flight poll result after switching conversations", async () => {
    vi.useFakeTimers()
    const oldPoll = deferred<{ items: Array<{ id: string; role: "user" | "assistant"; content: string; status: "done"; created_at: string }>; count: number }>()
    try {
      mocks.listChatConversations.mockResolvedValue({
        items: [{ session_id: "new-session", subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title: "新会话", preview: "新答案" }],
        count: 1,
      })
      mocks.sendChatMessage.mockResolvedValueOnce({ session_id: "old-session", message_id: "old-answer", status: "pending" })
      mocks.listChatMessages.mockImplementation((_subject: string, sessionId?: string) => {
        if (sessionId === "old-session") return oldPoll.promise
        return Promise.resolve({
          items: [
            { id: "new-user", role: "user", content: "新问题", status: "done", created_at: "2026-08-04T00:00:00Z" },
            { id: "new-ai", role: "assistant", content: "新答案", status: "done", created_at: "2026-08-04T00:00:01Z" },
          ],
          count: 2,
        })
      })
      render(<Chat />)
      await act(async () => undefined)

      fireEvent.change(screen.getByLabelText("发给 AI 的消息"), { target: { value: "旧问题" } })
      fireEvent.click(screen.getByRole("button", { name: "发送" }))
      await act(async () => undefined)
      await act(async () => vi.advanceTimersByTime(1500))
      expect(mocks.listChatMessages).toHaveBeenCalledWith("", "old-session", 50)

      fireEvent.click(screen.getByRole("button", { name: /新会话/ }))
      await act(async () => undefined)
      oldPoll.resolve({
        items: [{ id: "old-ai", role: "assistant", content: "旧答案", status: "done", created_at: "2026-08-04T00:00:01Z" }],
        count: 1,
      })
      await act(async () => undefined)

      expect(screen.getAllByText("新答案").length).toBeGreaterThan(0)
      expect(screen.queryByText("旧答案")).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the conversations the reader paged through when an answer lands", async () => {
    // The refresh that follows a reply replaces the newest page. Doing that to a
    // list the reader had paged through threw the older rows away -- an automatic
    // action undoing something they had asked for.
    vi.useFakeTimers()
    try {
      const conversation = (id: string, title: string) => ({
        session_id: id, subject: "math", message_count: 2, last_at: "2026-08-04T00:00:00Z", title, preview: `${title}的内容`,
      })
      mocks.listChatConversations.mockImplementation((_subject: string, _limit: number, _query: string, offset = 0) =>
        Promise.resolve(
          offset === 0
            ? { items: [conversation("s-new", "最新一段"), conversation("s-2", "第二段")], count: 3 }
            : { items: [conversation("s-old", "很早以前的一段")], count: 3 },
        ),
      )
      render(<Chat />)
      await act(async () => undefined)

      fireEvent.click(screen.getByRole("button", { name: "加载更多（还有 1 段）" }))
      await act(async () => undefined)
      expect(screen.getByText("很早以前的一段")).toBeInTheDocument()

      mocks.sendChatMessage.mockResolvedValue({ session_id: "s-new", message_id: "ai-1", status: "pending" })
      mocks.listChatMessages.mockResolvedValue({
        items: [{ id: "a1", role: "assistant", content: "答案", status: "done", created_at: "2026-08-04T00:00:01Z" }],
        count: 1,
      })
      fireEvent.change(screen.getByLabelText("发给 AI 的消息"), { target: { value: "问题" } })
      fireEvent.click(screen.getByRole("button", { name: "发送" }))
      await act(async () => undefined)
      await act(async () => vi.advanceTimersByTime(1600))

      expect(screen.getByText("最新一段")).toBeInTheDocument()
      expect(screen.getByText("很早以前的一段")).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /加载更多/ })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("picking up a question left by 阅读", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useSubjectStore.setState({ subject: "all" })
    mocks.listChatMessages.mockResolvedValue({ items: [], count: 0 })
    mocks.listChatConversations.mockResolvedValue({ items: [], count: 0 })
    mocks.getQARecord.mockResolvedValue(null)
    mocks.saveQARecord.mockResolvedValue(null)
    mocks.listKnowledge.mockResolvedValue({ items: [], count: 0 })
    mocks.getKnowledge.mockResolvedValue({ id: "k-1", item_type: "brain_dump", term: "知识点", concise_definition: "", scheduled: false })
    mocks.scheduleKnowledge.mockResolvedValue({ status: "scheduled", knowledge_id: "k-1", prompt_count: 1 })
    mocks.listMistakes.mockResolvedValue([])
    mocks.listLessons.mockResolvedValue({ items: [], count: 0 })
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

  it("names the subject it is empty for, instead of the whole history", async () => {
    // The card is scoped to the subject in hand, so "还没有对话" would read as
    // "you have never asked anything" -- which it cannot know from here.
    mocks.listChatConversations.mockResolvedValue({ items: [], count: 0 })
    useSubjectStore.setState({ subject: "physics" })
    render(<Chat />)

    expect(await screen.findByText(/物理 下还没有对话/)).toBeInTheDocument()
  })
})
