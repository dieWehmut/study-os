import { useEffect, useRef, useState } from "react"
import { SendHorizonal, Sparkles } from "lucide-react"

import { listChatMessages, sendChatMessage } from "@/api/chat"
import type { ChatMessage } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { subjectName } from "@/lib/subjects"
import { SubjectBadge } from "@/features/subjects/SubjectBadge"
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

export default function Chat() {
  const subject = useSubjectStore((state) => state.subject)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<number | null>(null)
  const sentRef = useRef(false)

  useEffect(() => {
    let active = true
    listChatMessages(subject === "all" ? "" : subject, 50)
      .then((result) => {
        if (active && !sentRef.current) setMessages(result.items)
      })
      .catch(() => {
        if (active) setError("无法读取对话记录，请确认本地服务正在运行。")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [subject])

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" })
  }, [messages])

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [])

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
    try {
      await sendChatMessage(subject === "all" ? "all" : subject, message)
      const started = Date.now()
      const timer = window.setInterval(async () => {
        if (Date.now() - started > 120_000) {
          window.clearInterval(timer)
          pollRef.current = null
          setSending(false)
          return
        }
        const result = await listChatMessages(subject === "all" ? "" : subject, 50)
        setMessages(result.items)
        const hasPending = result.items.some((item) => item.status === "pending")
        if (!hasPending) {
          window.clearInterval(timer)
          pollRef.current = null
          setSending(false)
        }
      }, 1500)
      pollRef.current = timer
    } catch {
      setSending(false)
      setError("发送失败，请重试。")
    }
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="size-4 text-primary" />
            <h1 className="font-heading text-2xl font-semibold tracking-tight">答疑</h1>
          </div>
          <p className="text-sm text-muted-foreground">问题提交后立即返回，AI 在后台回答，完成后自动出现，不打断学习。</p>
        </div>
        {subject === "all" ? <Badge variant="secondary">综合</Badge> : <SubjectBadge subject={subject} />}
      </div>

      <Card className="min-h-96">
        <CardContent className="flex flex-col gap-3 p-4">
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
            {loading ? (
              <p className="py-16 text-center text-sm text-muted-foreground">正在读取对话…</p>
            ) : messages.length === 0 ? (
              <div className="grid gap-4 py-8">
                <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                  还没有对话。把想不通的问题直接扔进来，AI 会在后台回答。
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

      <div className="flex items-end gap-2">
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
    </section>
  )
}
