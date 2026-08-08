import { useCallback, useEffect, useRef, useState } from "react"
import { MessageSquarePlus, Paperclip, SendHorizonal, Sparkles } from "lucide-react"

import {
  listChatConversations,
  listChatMessages,
  sendChatMessage,
  uploadChatAttachment,
  type ChatAttachmentResult,
  type ChatConversation,
} from "@/api/chat"
import type { ChatMessage } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SubjectChips } from "@/features/subjects/SubjectChips"
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

export default function Chat() {
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)
  const [conversations, setConversations] = useState<ChatConversation[]>([])
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
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<number | null>(null)
  const sentRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshConversations = useCallback(() => {
    return listChatConversations(subject === "all" ? "" : subject, 50)
      .then((result) => setConversations(result.items))
      .catch(() => {
        // 对话列表加载失败不阻塞提问。
      })
      .finally(() => setLoading(false))
  }, [subject])

  useEffect(() => {
    void refreshConversations()
  }, [refreshConversations])

  function resetChat() {
    sentRef.current = false
    setActiveSession(null)
    setMessages([])
    setAttachments([])
    setError("")
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
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [])

  function openConversation(sessionId: string) {
    sentRef.current = true
    setActiveSession(sessionId)
    setMessages([])
    setLoading(true)
    setError("")
    listChatMessages(subject === "all" ? "" : subject, sessionId, 50)
      .then((result) => setMessages(result.items))
      .catch(() => setError("读取对话失败，请重试。"))
      .finally(() => setLoading(false))
  }

  function startNewChat() {
    sentRef.current = false
    setActiveSession(null)
    setMessages([])
    setAttachments([])
    setError("")
  }

  async function send() {
    const message = draft.trim()
    if (!message || sending) return
    setSending(true)
    setError("")
    sentRef.current = true
    const now = new Date().toISOString()
    setMessages((current) => [
      ...current,
      { id: `local-user-${Date.now()}`, role: "user", content: message, status: "done", created_at: now },
      { id: `local-ai-${Date.now()}`, role: "assistant", content: "", status: "pending", created_at: now },
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
      setActiveSession(result.session_id)
      setAttachments([])
      const sessionId = result.session_id
      const started = Date.now()
      const timer = window.setInterval(async () => {
        if (Date.now() - started > 120_000) {
          window.clearInterval(timer)
          pollRef.current = null
          setSending(false)
          return
        }
        const result = await listChatMessages(subject === "all" ? "" : subject, sessionId, 50)
        setMessages(result.items)
        const hasPending = result.items.some((item) => item.status === "pending")
        if (!hasPending) {
          window.clearInterval(timer)
          pollRef.current = null
          setSending(false)
          void refreshConversations()
        }
      }, 1500)
      pollRef.current = timer
    } catch {
      setSending(false)
      setError("发送失败，请重试。")
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
    } catch {
      setError("附件上传失败，请确认文件不超过 5MB。")
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
          </CardHeader>
          <CardContent className="grid gap-2">
            {conversations.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                还没有对话，点击「新对话」开始。
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
            <div className="flex items-end gap-2">
              <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => void handleFile(event)} />
              <Button type="button" variant="outline" size="icon" aria-label="上传附件" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                <Paperclip aria-hidden="true" />
              </Button>
              <textarea
                aria-label="发给 AI 的消息"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void send()
                }}
                placeholder={`在「${subject === "all" ? "综合" : subjectName(subject)}」下提问…（Ctrl + Enter 发送）`}
                className="min-h-20 flex-1 resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button disabled={!draft.trim() || sending} onClick={() => void send()}>
                <SendHorizonal data-icon="inline-start" />{sending ? "已提交" : "发送"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
