import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, CheckCircle2, LibraryBig, MessageSquarePlus, Paperclip, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"

import { ApiError } from "@/api/client"
import { failureMessage } from "@/lib/errors"
import { answerNote } from "@/lib/review-note"
import {
  dumpThought,
  getQARecord,
  listChatConversations,
  listChatMessages,
  saveQARecord,
  sendChatMessage,
  uploadChatAttachment,
  type ChatAttachmentResult,
  type ChatConversation,
  type QARecord,
  type QARecordInput,
} from "@/api/chat"
import { getKnowledge, listKnowledge, scheduleKnowledge } from "@/api/knowledge"
import { listLessons } from "@/api/lessons"
import { listMistakes } from "@/api/mistakes"
import type { ChatMessage } from "@/api/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { SubjectChips } from "@/features/subjects/SubjectChips"
import QARecordPanel, { type QAContextOption, type QARecordQueueTarget } from "@/features/chat/QARecordPanel"
import { qaContextValue } from "@/features/chat/qa-record"
import { takeAskDraft } from "@/lib/ask-draft"
import { subjectName } from "@/lib/subjects"
import { cn } from "@/lib/utils"
import { useSubjectStore } from "@/store/useSubjectStore"

const suggestions: Record<string, string[]> = {
  all: ["今天该复习什么？", "帮我总结最近学的知识点"],
  chinese: ["文言文实词怎么记？", "古诗文默写怎么快速过一遍？"],
  math: ["二级结论有哪些常见题型？", "导数和单调性有什么关系？"],
  english: ["abandon 和 give up 有什么区别？", "帮我造几个背单词的句子"],
  physics: ["速度与加速度怎么区分？", "动能定理的适用条件是什么？"],
  chemistry: ["怎么快速配平方程式？", "氧化还原反应怎么判断？"],
  geography: ["气候类型怎么记？", "区位因素有哪些分类？"],
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

interface CompletedTurn {
  id: string
  question: string
  answer: string
}

/**
 * What happened the last time this record's knowledge point was sent to the
 * review queue. Held here rather than in the panel so that saving the record --
 * which remounts the panel -- does not throw away the answer the server gave.
 * It carries the turn it belongs to, so a result can never be read against a
 * later record without anything having to be cleared on the way in.
 */
interface QAQueueState {
  key: string
  knowledgeId: string
  status: "scheduling" | "queued" | "failed"
  promptCount: number
  error: string
}

function latestCompletedTurn(items: ChatMessage[]): CompletedTurn | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const assistant = items[index]
    if (assistant.role !== "assistant") continue
    if (items.slice(index + 1).some((item) => item.role === "user")) return null
    if (assistant.status !== "done" || !assistant.content.trim()) continue
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      if (items[previous].role === "user") {
        if (!items[previous].content.trim()) return null
        return { id: assistant.id, question: items[previous].content, answer: assistant.content }
      }
    }
    return null
  }
  return null
}

export default function Chat() {
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  // The query the list is currently filtered by, and the box you type in. They
  // are separate so the list does not re-ask the server on every keystroke and
  // so 清除 can put back what the box no longer holds.
  const [conversationQuery, setConversationQuery] = useState("")
  const [conversationDraft, setConversationDraft] = useState("")
  // How many conversations there are, when that is more than are in hand.
  const [conversationTotal, setConversationTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Read once, in the initializer, and cleared in the same breath: arriving
  // from 阅读 with sections that did not land should find them already written
  // out, and arriving here on your own weeks later should not.
  const [draft, setDraft] = useState(takeAskDraft)
  const [attachments, setAttachments] = useState<ChatAttachmentResult[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [qaRecord, setQARecord] = useState<QARecord | null>(null)
  const [qaSaving, setQASaving] = useState(false)
  const [qaError, setQAError] = useState("")
  const [qaSavedAt, setQASavedAt] = useState("")
  const [qaContextOptions, setQAContextOptions] = useState<QAContextOption[]>([])
  const [qaLoadedKey, setQALoadedKey] = useState<string | null>(null)
  const [qaContextLoadedKey, setQAContextLoadedKey] = useState<string | null>(null)
  // Which of the knowledge points on offer already carry review cards, as
  // answered by the same list request that built the 关联对象 options.
  const [qaScheduled, setQAScheduled] = useState<string[]>([])
  const [qaQueue, setQAQueue] = useState<QAQueueState | null>(null)
  /**
   * The saved record's linked knowledge point, read by id. The 关联对象 list is
   * a capped, subject-filtered page, so this is the only reliable answer for the
   * item the record actually points at.
   */
  const [qaLinked, setQALinked] = useState<{ id: string; term: string; scheduled: boolean } | null>(null)
  const [qaContextSearching, setQAContextSearching] = useState(false)
  const [qaContextSearchNote, setQAContextSearchNote] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<number | null>(null)
  const conversationRequestRef = useRef(0)
  const qaRequestRef = useRef(0)
  const qaSaveRequestRef = useRef(0)
  const qaQueueRequestRef = useRef(0)
  const qaContextSearchRef = useRef(0)
  const activeSessionRef = useRef<string | null>(null)
  const sendRequestRef = useRef(0)
  const localMessageCounterRef = useRef(0)
  const sentRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  /**
   * Re-read the conversation list.
   *
   * `keep-loaded` is for the refresh after an answer lands: replacing the list
   * there collapsed it back to the newest 50, throwing away the pages the reader
   * had asked for. A filter change still replaces -- the rows under it belong to
   * the subject or search that just went away.
   */
  const refreshConversations = useCallback((mode: "replace" | "keep-loaded" = "replace") => {
    return listChatConversations(subject === "all" ? "" : subject, 50, conversationQuery)
      .then((result) => {
        setConversations((current) => {
          if (mode === "replace") return result.items
          const fresh = new Set(result.items.map((item) => item.session_id))
          return [...result.items, ...current.filter((item) => !fresh.has(item.session_id))]
        })
        setConversationTotal(result.count)
      })
      .catch(() => {
        // 对话列表加载失败不阻塞提问。
      })
      .finally(() => setLoading(false))
  }, [subject, conversationQuery])

  /**
   * The next page of conversations, appended.
   *
   * The list is the newest 50 and the count is how many there are, so without
   * this an older 问答 is unreachable by browsing -- only by remembering a word
   * from it.
   */
  async function loadMoreConversations() {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const result = await listChatConversations(
        subject === "all" ? "" : subject,
        50,
        conversationQuery,
        conversations.length,
      )
      setConversations((current) => {
        const seen = new Set(current.map((item) => item.session_id))
        return [...current, ...result.items.filter((item) => !seen.has(item.session_id))]
      })
      setConversationTotal(result.count)
    } catch {
      // The loaded page stays on screen; the attempt costs nothing but a click.
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void refreshConversations()
  }, [refreshConversations])

  function resetChat() {
    conversationRequestRef.current += 1
    qaRequestRef.current += 1
    qaSaveRequestRef.current += 1
    qaQueueRequestRef.current += 1
    sendRequestRef.current += 1
    stopPolling()
    sentRef.current = false
    activeSessionRef.current = null
    setSending(false)
    setActiveSession(null)
    setMessages([])
    setAttachments([])
    setError("")
    setQARecord(null)
    setQASaving(false)
    setQAError("")
    setQASavedAt("")
    setQAContextOptions([])
    setQAContextSearchNote("")
    setQALoadedKey(null)
    setQAContextLoadedKey(null)
    setQAScheduled([])
    setQAQueue(null)
    setQALinked(null)
  }

  function changeSubject(value: string) {
    resetChat()
    setSubject(value)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" })
  }, [messages])

  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  function openConversation(sessionId: string) {
    const requestID = ++conversationRequestRef.current
    qaRequestRef.current += 1
    qaSaveRequestRef.current += 1
    qaQueueRequestRef.current += 1
    sendRequestRef.current += 1
    stopPolling()
    sentRef.current = true
    activeSessionRef.current = sessionId
    setSending(false)
    setActiveSession(sessionId)
    setMessages([])
    setLoading(true)
    setError("")
    setQARecord(null)
    setQASaving(false)
    setQAError("")
    setQASavedAt("")
    setQAContextOptions([])
    setQAContextSearchNote("")
    setQALoadedKey(null)
    setQAContextLoadedKey(null)
    setQAScheduled([])
    setQAQueue(null)
    setQALinked(null)
    listChatMessages(subject === "all" ? "" : subject, sessionId, 50)
      .then((result) => {
        if (conversationRequestRef.current === requestID) setMessages(result.items)
      })
      .catch(() => {
        if (conversationRequestRef.current === requestID) setError("读取对话失败，请重试。")
      })
      .finally(() => {
        if (conversationRequestRef.current === requestID) setLoading(false)
      })
  }

  function startNewChat() {
    conversationRequestRef.current += 1
    qaRequestRef.current += 1
    qaSaveRequestRef.current += 1
    qaQueueRequestRef.current += 1
    sendRequestRef.current += 1
    stopPolling()
    sentRef.current = false
    activeSessionRef.current = null
    setSending(false)
    setActiveSession(null)
    setMessages([])
    setAttachments([])
    setError("")
    setQARecord(null)
    setQASaving(false)
    setQAError("")
    setQASavedAt("")
    setQAContextOptions([])
    setQAContextSearchNote("")
    setQALoadedKey(null)
    setQAContextLoadedKey(null)
    setQAScheduled([])
    setQAQueue(null)
    setQALinked(null)
  }

  const completedTurn = useMemo(() => latestCompletedTurn(messages), [messages])
  const qaPrefill = useMemo<Partial<QARecordInput> | undefined>(() => {
    if (!completedTurn || qaRecord) return undefined
    return { original_understanding: completedTurn.question, corrected_model: completedTurn.answer }
  }, [completedTurn, qaRecord])
  const completedQuestion = completedTurn?.question ?? ""
  const completedAnswer = completedTurn?.answer ?? ""
  const completedTurnID = completedTurn?.id ?? ""
  const qaKey = activeSession && completedTurn
    ? `${activeSession}:${completedTurn.id}`
    : ""
  const qaLoading = Boolean(qaKey && qaLoadedKey !== qaKey)
  const qaContextLoading = Boolean(qaKey && qaContextLoadedKey !== qaKey)

  // 存进知识库: an answer is worth keeping only if it comes back. The same
  // one-click path exists on a 阅读 section; here the question is the prompt and
  // the answer is the model to recall.
  const [intakeKey, setIntakeKey] = useState("")
  const [intakePending, setIntakePending] = useState(false)
  const [intakeError, setIntakeError] = useState("")

  async function fileAnswer() {
    if (!completedTurn || intakePending) return
    const turn = completedTurn
    setIntakePending(true)
    setIntakeError("")
    try {
      const item = await dumpThought(answerNote(turn.question, turn.answer))
      // Filing without queueing is a library you never look at again; this button
      // is about the answer coming back tomorrow.
      await scheduleKnowledge(item.id)
      setIntakeKey(turn.id)
    } catch (reason) {
      setIntakeError(failureMessage(reason, "收进知识库失败"))
    } finally {
      setIntakePending(false)
    }
  }

  // 回流 can only act on what the server already holds: a saved record whose
  // link is a knowledge point. A 错题 or 课程 link has no review card behind it,
  // and the draft's current selection is not a decision until it is saved --
  // queueing a card the record does not actually point at would be worse than
  // offering nothing.
  const qaQueueTarget = useMemo<QARecordQueueTarget | null>(() => {
    if (qaRecord?.context_type !== "knowledge_item" || !qaRecord.context_id) return null
    const knowledgeId = qaRecord.context_id
    // The 关联对象 list is capped and filtered by the subject chip, so the item
    // a record was saved against can easily be missing from it. The record's own
    // id is what it points at, so ask the point itself rather than guessing from
    // a page: without this, a queued item reads as not queued and shows the
    // button again, and the copy loses its name.
    const linked = qaLinked?.id === knowledgeId ? qaLinked : null
    const option = qaContextOptions.find((entry) => entry.value === qaContextValue("knowledge_item", knowledgeId))
    const justQueued = qaQueue?.key === qaKey
      && qaQueue.knowledgeId === knowledgeId
      && qaQueue.status === "queued"
    return {
      knowledgeId,
      label: option ? option.label.replace(/^知识点：/, "") : linked?.term ?? "",
      queued: justQueued || qaScheduled.includes(knowledgeId) || linked?.scheduled === true,
    }
  }, [qaRecord, qaContextOptions, qaScheduled, qaQueue, qaKey, qaLinked])

  // A failure or a summary belongs to the target it happened for, on the turn it
  // happened for; a record that has since been re-linked, or a newer answer,
  // must not wear the previous result.
  const qaQueueForTarget = qaQueue && qaQueue.key === qaKey && qaQueue.knowledgeId === qaQueueTarget?.knowledgeId
    ? qaQueue
    : null

  useEffect(() => {
    const sessionID = activeSession
    const requestID = ++qaRequestRef.current
    if (!sessionID || !completedAnswer) return
    const currentKey = `${sessionID}:${completedTurnID}`

    void getQARecord(sessionID)
      .then((record) => {
        if (qaRequestRef.current !== requestID) return
        setQARecord(record)
        setQAError("")
        // One item, read by id: its name and 复习状态 travel together, and
        // neither is on the page of 关联对象 options when the item is not.
        if (record?.context_type === "knowledge_item" && record.context_id) {
          const linkedID = record.context_id
          void getKnowledge(linkedID)
            .then((item) => {
              if (qaRequestRef.current === requestID) {
                setQALinked({ id: linkedID, term: item.term, scheduled: item.scheduled === true })
              }
            })
            .catch(() => {
              // A missing or unreachable item leaves the panel with what the
              // list offered; it must not block the record itself.
              if (qaRequestRef.current === requestID) setQALinked(null)
            })
        } else {
          setQALinked(null)
        }
      })
      .catch(() => {
        if (qaRequestRef.current === requestID) setQAError("读取学习记录失败，仍可填写新的记录。")
      })
      .finally(() => {
        if (qaRequestRef.current === requestID) setQALoadedKey(currentKey)
      })

    const subjectFilter = subject === "all" ? undefined : subject
    void Promise.allSettled([
      listKnowledge({ subject: subjectFilter, limit: 100, offset: 0 }),
      listMistakes(subjectFilter ? { subject: subjectFilter, limit: 100 } : { limit: 100 }),
      listLessons({ subject: subjectFilter, limit: 100, offset: 0 }),
    ]).then(([knowledge, mistakes, lessons]) => {
      if (qaRequestRef.current !== requestID) return
      const options: QAContextOption[] = []
      if (knowledge.status === "fulfilled") {
        for (const item of knowledge.value.items) {
          options.push({ value: qaContextValue("knowledge_item", item.id), label: `知识点：${item.term}` })
        }
      }
      if (mistakes.status === "fulfilled") {
        for (const item of mistakes.value) {
          if (item.questionId) options.push({ value: qaContextValue("question", item.questionId), label: `错题：${item.question}` })
        }
      }
      if (lessons.status === "fulfilled") {
        for (const item of lessons.value.items) {
          options.push({ value: qaContextValue("lesson", item.id), label: `课程：${item.title}` })
        }
      }
      // Merged, not replaced: a search can answer before this page does, and the
// reader's find must not be thrown away by the list catching up. The options were
// cleared when the session changed, so this is normally a plain assignment.
      setQAContextOptions((current) => {
        const known = new Set(options.map((option) => option.value))
        return [...options, ...current.filter((option) => !known.has(option.value))]
      })
      setQAScheduled(knowledge.status === "fulfilled" ? knowledge.value.scheduled_ids ?? [] : [])
      setQAContextLoadedKey(currentKey)
    })
  }, [activeSession, completedQuestion, completedAnswer, completedTurnID, subject])

  async function handleQASave(input: QARecordInput) {
    const sessionID = activeSession
    if (!sessionID) return
    const requestID = ++qaSaveRequestRef.current
    setQASaving(true)
    setQAError("")
    setQASavedAt("")
    try {
      const saved = await saveQARecord(sessionID, input)
      if (activeSessionRef.current !== sessionID || qaSaveRequestRef.current !== requestID) return
      setQARecord(saved)
      setQASavedAt(formatTime(saved.updated_at) || saved.updated_at)
    } catch {
      if (activeSessionRef.current === sessionID && qaSaveRequestRef.current === requestID) setQAError("保存学习记录失败，请重试。")
    } finally {
      if (activeSessionRef.current === sessionID && qaSaveRequestRef.current === requestID) setQASaving(false)
    }
  }

  /**
   * Find something the 关联对象 list never offered.
   *
   * That list is one subject-filtered page of the newest items of each kind, so
   * in a real library most words, mistakes and courses are simply absent from
   * it. Searching asks every list by text and appends what comes back, which is
   * what makes an older one linkable at all.
   */
  async function searchContexts(query: string) {
    const trimmed = query.trim()
    if (!trimmed) return
    const requestID = ++qaContextSearchRef.current
    setQAContextSearching(true)
    setQAContextSearchNote("")
    try {
      const [knowledge, mistakes, lessons] = await Promise.allSettled([
        listKnowledge({ query: trimmed, limit: 20, offset: 0 }),
        listMistakes({ query: trimmed, limit: 20 }),
        listLessons({ query: trimmed, limit: 20, offset: 0 }),
      ])
      if (qaContextSearchRef.current !== requestID) return
      const found: QAContextOption[] = []
      if (knowledge.status === "fulfilled") {
        for (const item of knowledge.value.items) {
          found.push({ value: qaContextValue("knowledge_item", item.id), label: `知识点：${item.term}` })
        }
      }
      if (mistakes.status === "fulfilled") {
        for (const item of mistakes.value) {
          if (item.questionId) found.push({ value: qaContextValue("question", item.questionId), label: `错题：${item.question}` })
        }
      }
      if (lessons.status === "fulfilled") {
        for (const item of lessons.value.items) {
          found.push({ value: qaContextValue("lesson", item.id), label: `课程：${item.title}` })
        }
      }
      if (found.length === 0) {
        setQAContextSearchNote(`没有匹配「${trimmed}」的知识点、错题或课程`)
        return
      }
      setQAContextOptions((current) => {
        // Matches go to the front. The list is three pages of a hundred plus
        // whatever was searched before, and a native select opens at the top:
        // appending the answer is the same as hiding it.
        const known = new Set(found.map((option) => option.value))
        return [...found, ...current.filter((option) => !known.has(option.value))]
      })
      setQAContextSearchNote(`找到 ${found.length} 条，已排到列表最前面`)
    } catch {
      if (qaContextSearchRef.current === requestID) setQAContextSearchNote("搜索失败，请重试")
    } finally {
      if (qaContextSearchRef.current === requestID) setQAContextSearching(false)
    }
  }

  /**
   * Send the record's knowledge point to the review queue -- only ever because
   * the learner pressed the button. Nothing here runs on save: a half-finished
   * record must not decide what next week's reviews contain.
   */
  async function handleQASchedule(knowledgeID: string) {
    const sessionID = activeSession
    if (!sessionID) return
    const requestID = ++qaQueueRequestRef.current
    setQAQueue({ key: qaKey, knowledgeId: knowledgeID, status: "scheduling", promptCount: 0, error: "" })
    try {
      const result = await scheduleKnowledge(knowledgeID)
      if (activeSessionRef.current !== sessionID || qaQueueRequestRef.current !== requestID) return
      // The server answers 200 either way and says which happened. Reporting
      // "已排进复习 · N 张卡" for cards it did not write would claim a fresh
      // schedule for an item that was already in the plan -- which is what you
      // get whenever the linked point sits outside the page of knowledge items
      // this panel loaded its 复习状态 from.
      const alreadyScheduled = result.status === "already_scheduled"
      setQAQueue({
        key: qaKey,
        knowledgeId: knowledgeID,
        status: "queued",
        promptCount: alreadyScheduled ? 0 : result.prompt_count,
        error: "",
      })
    } catch {
      if (activeSessionRef.current === sessionID && qaQueueRequestRef.current === requestID) {
        setQAQueue({ key: qaKey, knowledgeId: knowledgeID, status: "failed", promptCount: 0, error: "排进复习失败，请重试。" })
      }
    }
  }

  async function send() {
    const message = draft.trim()
    if (!message || sending) return
    const sendRequestID = ++sendRequestRef.current
    const sessionAtStart = activeSessionRef.current
    qaRequestRef.current += 1
    qaSaveRequestRef.current += 1
    setSending(true)
    setError("")
    setQASaving(false)
    setQAError("")
    sentRef.current = true
    const now = new Date().toISOString()
    const localMessageID = ++localMessageCounterRef.current
    setMessages((current) => [
      ...current,
      { id: `local-user-${localMessageID}`, role: "user", content: message, status: "done", created_at: now },
      { id: `local-ai-${localMessageID}`, role: "assistant", content: "", status: "pending", created_at: now },
    ])
    setDraft("")
    const attachmentIds = attachments.map((attachment) => attachment.id)
    try {
      const result = await sendChatMessage(
        subject === "all" ? "all" : subject,
        message,
        activeSession ?? undefined,
        attachmentIds.length > 0 ? attachmentIds : undefined,
      )
      if (sendRequestRef.current !== sendRequestID || activeSessionRef.current !== sessionAtStart) return
      activeSessionRef.current = result.session_id
      setActiveSession(result.session_id)
      setAttachments([])
      const sessionId = result.session_id
      stopPolling()
      let pollsRemaining = 80
      const timer = window.setInterval(async () => {
        if (sendRequestRef.current !== sendRequestID || activeSessionRef.current !== sessionId) {
          window.clearInterval(timer)
          if (pollRef.current === timer) pollRef.current = null
          return
        }
        pollsRemaining -= 1
        if (pollsRemaining <= 0) {
          window.clearInterval(timer)
          if (pollRef.current === timer) pollRef.current = null
          if (sendRequestRef.current === sendRequestID) setSending(false)
          return
        }
        try {
          const result = await listChatMessages(subject === "all" ? "" : subject, sessionId, 50)
          if (sendRequestRef.current !== sendRequestID || activeSessionRef.current !== sessionId) return
          setMessages(result.items)
          const hasPending = result.items.some((item) => item.status === "pending")
          if (!hasPending) {
            window.clearInterval(timer)
            if (pollRef.current === timer) pollRef.current = null
            setSending(false)
            void refreshConversations("keep-loaded")
          }
        } catch (reason) {
          window.clearInterval(timer)
          if (pollRef.current === timer) pollRef.current = null
          if (sendRequestRef.current === sendRequestID) {
            setSending(false)
            setError(failureMessage(reason, "读取回答失败"))
          }
        }
      }, 1500)
      pollRef.current = timer
    } catch (reason) {
      if (sendRequestRef.current === sendRequestID) {
        setSending(false)
        // The server knows whether it was the AI configuration, the request, or
        // nothing at all ("发送失败，请重试" hid a missing API key).
        setError(failureMessage(reason, "发送失败"))
      }
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || uploading) return
    setUploading(true)
    setError("")
    try {
      const result = await uploadChatAttachment(file)
      setAttachments((current) => [...current, result])
    } catch (reason) {
      // The server knows why it refused (too large, storage failed) and says so
      // in the reader's language for 4xx. Guessing "请确认文件不超过 5MB" told
      // someone whose disk was full to check the size of their file.
      const detail = reason instanceof ApiError && reason.status >= 400 && reason.status < 500 ? reason.message : ""
      setError(detail ? `附件上传失败：${detail}` : "附件上传失败，请确认本地后端正在运行。")
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-5">
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="size-4 text-primary" />
        <h1 className="font-heading text-2xl font-semibold tracking-tight">答疑</h1>
      </div>
      <SubjectChips subject={subject} onSelect={changeSubject} />

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader className="gap-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>对话</CardTitle>
              <Button size="sm" variant="outline" onClick={startNewChat}>
                <MessageSquarePlus data-icon="inline-start" />新对话
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{subject === "all" ? "综合" : subjectName(subject)} 的对话列表</p>
            {/* Only the newest page of conversations is listed, so an older 问答
                is not hard to find here -- it is not in the list at all. */}
            <div className="flex items-center gap-2">
              <Input
                aria-label="搜索对话内容"
                value={conversationDraft}
                onChange={(event) => setConversationDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  setConversationQuery(conversationDraft.trim())
                }}
                placeholder="搜对话里说过的词"
                className="h-9"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="搜索对话"
                disabled={!conversationDraft.trim() || conversationDraft.trim() === conversationQuery}
                onClick={() => setConversationQuery(conversationDraft.trim())}
                className="shrink-0"
              >
                搜索
              </Button>
            </div>
            {conversationQuery ? (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                只显示提到「{conversationQuery}」的对话
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => {
                    setConversationDraft("")
                    setConversationQuery("")
                  }}
                >
                  清除
                </button>
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-2">
            {conversations.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                {conversationQuery
                  ? `没有对话提到「${conversationQuery}」。`
                  // Named, because the card is scoped to the subject in hand:
                  // "还没有对话" reads as the whole history being empty, which is
                  // the one thing the list cannot know from here.
                  : `${subject === "all" ? "综合" : subjectName(subject)} 下还没有对话，点击「新对话」开始。`}
              </p>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.session_id}
                  type="button"
                  onClick={() => openConversation(conversation.session_id)}
                  className={cn(
                    "grid gap-1 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/50",
                    activeSession === conversation.session_id
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-muted/25",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{conversation.title || "未命名对话"}</span>
                    <span className="shrink-0 text-[0.68rem] text-muted-foreground">{formatTime(conversation.last_at)}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {conversation.preview || `${conversation.message_count} 条消息`}
                  </span>
                </button>
              ))
            )}
            {conversations.length > 0 && conversationTotal > conversations.length ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={loadingMore}
                onClick={() => void loadMoreConversations()}
              >
                {loadingMore ? "正在读取…" : `加载更多（还有 ${conversationTotal - conversations.length} 段）`}
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="min-h-[26rem]">
            <CardContent className="flex flex-col gap-3 p-4">
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
                {loading ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">正在读取对话…</p>
                ) : messages.length === 0 ? (
                  <div className="grid gap-4 py-8">
                    <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                      把想不通的问题直接扔进来，AI 会在后台回答；也可以上传文件让 AI 一起看。
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">试试：</span>
                      {(suggestions[subject] ?? suggestions.all).map((question) => (
                        <button
                          key={question}
                          type="button"
                          onClick={() => setDraft(question)}
                          className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div key={message.id} className={message.role === "user" ? "flex max-w-[85%] flex-col items-end gap-1 self-end" : "flex max-w-[85%] flex-col items-start gap-1 self-start"}>
                      <span className="text-[0.68rem] text-muted-foreground">{message.role === "user" ? "你" : "AI"}</span>
                      <div
                        className={
                          message.role === "user"
                            ? "rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm leading-6"
                            : "rounded-2xl rounded-bl-sm border border-border bg-muted/30 px-4 py-2.5 text-sm leading-6"
                        }
                      >
                        {message.status === "pending" ? (
                          <p className="text-muted-foreground">AI 正在思考…</p>
                        ) : (
                          <p className="whitespace-pre-wrap">{message.content || "（无内容）"}</p>
                        )}
                        {message.status === "failed" ? <p className="mt-1 text-xs text-destructive">{message.error_summary || "回答失败"}</p> : null}
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>
            </CardContent>
          </Card>

          {activeSession && completedTurn ? (
            <QARecordPanel
              key={`${activeSession}:${qaRecord?.id ?? "draft"}:${qaRecord?.updated_at ?? ""}`}
              sessionId={activeSession}
              subject={subject}
              subjectLabel={subject === "all" ? "综合" : subjectName(subject)}
              initialRecord={qaRecord}
              prefill={qaPrefill}
              loading={qaLoading}
              saving={qaSaving}
              error={qaError}
              savedAt={qaSavedAt}
              contextOptions={qaContextOptions}
              contextLoading={qaContextLoading}
              onSave={handleQASave}
              onSearchContexts={searchContexts}
              searchingContexts={qaContextSearching}
              contextSearchNote={qaContextSearchNote}
              queueTarget={qaQueueTarget}
              queueScheduling={qaQueueForTarget?.status === "scheduling"}
              queuePromptCount={qaQueueForTarget?.status === "queued" ? qaQueueForTarget.promptCount : 0}
              queueError={qaQueueForTarget?.error ?? ""}
              onSchedule={handleQASchedule}
            />
          ) : null}

          {/* The other way out of an answer: into 复习 rather than into a record.
              Both are one click from here because neither is obviously the right
              one -- a solved question is evidence, and a explained concept is a
              card. */}
          {activeSession && completedTurn ? (
            <Card>
              <CardHeader className="gap-1.5">
                <CardTitle className="text-base">把这段回答收进知识库</CardTitle>
                <p className="text-sm text-muted-foreground">
                  问题作为题干、回答作为答案，并直接排进复习——明天它会作为一张卡回来。
                </p>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={intakePending || intakeKey === completedTurn.id}
                  onClick={() => void fileAnswer()}
                >
                  {intakeKey === completedTurn.id ? (
                    <>
                      <CheckCircle2 data-icon="inline-start" />已收进知识库
                    </>
                  ) : (
                    <>
                      <LibraryBig data-icon="inline-start" />{intakePending ? "正在保存…" : "收进知识库"}
                    </>
                  )}
                </Button>
                {intakeKey === completedTurn.id ? (
                  <>
                    <Link to="/memory" className={buttonVariants({ variant: "outline", size: "sm" })}>
                      去记忆
                    </Link>
                    <Link to="/knowledge" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      去知识库
                    </Link>
                  </>
                ) : null}
                {intakeError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {intakeError}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-2">
            {attachments.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {attachments.map((attachment) => (
                  <span key={attachment.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs">
                    <Paperclip aria-hidden="true" className="size-3 text-primary" />
                    {attachment.name}
                    <button
                      type="button"
                      aria-label={`移除附件 ${attachment.name}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div
              role="group"
              aria-label="消息编辑器"
              className="relative min-h-28 rounded-3xl border border-input bg-background transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"
            >
              <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => void handleFile(event)} />
              <textarea
                aria-label="发给 AI 的消息"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void send()
                }}
                placeholder={`在「${subject === "all" ? "综合" : subjectName(subject)}」下提问…`}
                className="min-h-28 w-full resize-y rounded-3xl border-0 bg-transparent px-4 pt-4 pr-24 pb-14 text-sm outline-none"
              />
              <div role="group" aria-label="消息操作" className="absolute right-3 bottom-3 flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full text-muted-foreground"
                  aria-label="上传附件"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon-lg"
                  className="rounded-full"
                  aria-label={sending ? "已提交" : "发送"}
                  disabled={!draft.trim() || sending}
                  onClick={() => void send()}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
              </div>
            </div>
            {/* The rule before the attempt: the upload button had no accept list
                and the failure copy guessed, so the limit was only ever learned
                by being refused. */}
            <p className="text-xs text-muted-foreground">
              附件单个不超过 5MB：文本附件会把内容读进提问，其它格式只保存原文件。
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
