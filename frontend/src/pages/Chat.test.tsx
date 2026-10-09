import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { QARecord } from "@/api/chat"
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

  it("uploads an attachment and shows it before sending", async () => {
    render(<Chat />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(["hello"], "notes.txt", { type: "text/plain" })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(mocks.uploadChatAttachment).toHaveBeenCalled())
    expect(await screen.findByText("notes.txt")).toBeInTheDocument()
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
    fireEvent.change(box, { target: { value: "动能" } })
    fireEvent.click(screen.getByRole("button", { name: "搜索" }))

    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenCalledWith(expect.objectContaining({ query: "动能" })))
    expect(await screen.findByRole("option", { name: "知识点：动能定理" })).toBeInTheDocument()
    expect(await screen.findByRole("status")).toHaveTextContent("找到 1 条")
  })

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
    fireEvent.click(screen.getByRole("button", { name: "搜索" }))

    expect(await screen.findByRole("option", { name: "错题：求函数极值" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "课程：极值一节课" })).toBeInTheDocument()
    expect(await screen.findByRole("status")).toHaveTextContent("找到 2 条")
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
    fireEvent.click(screen.getByRole("button", { name: "新对话" }))

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
})
