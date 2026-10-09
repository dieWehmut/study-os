import { useState } from "react"

import type { QARecord, QARecordContextType, QARecordInput, QARecordStatus } from "@/api/chat"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { parseQAContextValue, qaContextValue } from "./qa-record"

export interface QARecordPanelProps {
  sessionId?: string | null
  subject: string
  subjectLabel?: string
  initialRecord?: QARecord | null
  loading?: boolean
  saving?: boolean
  error?: string | null
  prefill?: Partial<QARecordInput>
  contextOptions?: QAContextOption[]
  contextLoading?: boolean
  savedAt?: string
  onSave: (input: QARecordInput) => void | Promise<void>
  /**
   * Search the library for something to link. The options list is one page of
   * the newest items, so without this a word that fell off that page can never
   * be linked at all -- not just hard to find.
   */
  onSearchContexts?: (query: string) => void | Promise<void>
  searchingContexts?: boolean
  contextSearchNote?: string
  /**
   * The saved record's linked knowledge point, when the server-side record has
   * one. Absent means "nothing here can be queued" -- a record linked to a 错题
   * or a 课程 has no review card to make, and an empty 回流 block would just be
   * a permanent reminder of something that is not on offer.
   */
  queueTarget?: QARecordQueueTarget | null
  queueScheduling?: boolean
  queuePromptCount?: number
  queueError?: string | null
  onSchedule?: (knowledgeId: string) => void | Promise<void>
}

export interface QAContextOption {
  value: string
  label: string
}

export interface QARecordQueueTarget {
  knowledgeId: string
  /** The item's own name, when the page could resolve it. */
  label: string
  /** The item already contributes cards: the server says so, or it just did. */
  queued: boolean
}

interface Draft {
  original_understanding: string
  corrected_model: string
  mastery_evidence: string
  unresolved: string
  status: QARecordStatus
  contextValue: string
}

const statusOptions: Array<{ value: QARecordStatus; label: string }> = [
  { value: "open", label: "待消化" },
  { value: "understood", label: "已理解" },
  { value: "follow_up", label: "需要追问" },
]

function contextValue(type?: QARecordContextType | "", id?: string): string {
  return type && id ? qaContextValue(type, id) : ""
}

function draftFrom(record?: QARecord | null, prefill?: Partial<QARecordInput>): Draft {
  const source = record ?? prefill
  return {
    original_understanding: source?.original_understanding ?? "",
    corrected_model: source?.corrected_model ?? "",
    mastery_evidence: source?.mastery_evidence ?? "",
    unresolved: source?.unresolved ?? "",
    status: source?.status || "open",
    contextValue: contextValue(source?.context_type, source?.context_id),
  }
}

export default function QARecordPanel({
  sessionId,
  subject,
  subjectLabel,
  initialRecord,
  loading = false,
  saving = false,
  error = "",
  prefill,
  contextOptions = [],
  contextLoading = false,
  savedAt = "",
  onSave,
  onSearchContexts,
  searchingContexts = false,
  contextSearchNote = "",
  queueTarget = null,
  queueScheduling = false,
  queuePromptCount = 0,
  queueError = "",
  onSchedule,
}: QARecordPanelProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initialRecord, prefill))
  const [contextQuery, setContextQuery] = useState("")
  // The parent changes `key` when the server record identity/version changes.
  // Keeping initialization here avoids overwriting an in-progress draft from
  // an unrelated prop update.
  const hasSession = Boolean(sessionId?.trim())
  const disabled = !hasSession || loading || saving

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return

    const input: QARecordInput = {
      subject: subject.trim(),
      original_understanding: draft.original_understanding,
      corrected_model: draft.corrected_model,
      mastery_evidence: draft.mastery_evidence,
      unresolved: draft.unresolved,
      status: draft.status,
    }
    const context = parseQAContextValue(draft.contextValue)
    if (context) {
      const [contextType, contextID] = context
      input.context_type = contextType as QARecordContextType
      input.context_id = contextID
    }
    void onSave(input)
  }

  const statusMessage = !hasSession
    ? "先选择一段对话"
    : loading
      ? "正在读取记录"
      : saving
        ? "正在保存记录"
        : ""

  return (
    <Card aria-label="学习记录">
      <CardHeader className="gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>学习记录</CardTitle>
          {subject ? <span className="truncate text-xs text-muted-foreground">{subjectLabel ?? subject}</span> : null}
        </div>
      </CardHeader>
      <CardContent>
        {statusMessage ? (
          <p role="status" className="mb-4 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            {statusMessage}
          </p>
        ) : null}
        {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
        {savedAt ? <p className="mb-4 text-xs text-muted-foreground">已更新：{savedAt}</p> : null}

        {hasSession ? (
          <form className="grid gap-4" onSubmit={submit}>
            <label className="grid gap-1.5 text-sm" htmlFor="qa-context">
              <span>关联对象</span>
              <select
                id="qa-context"
                aria-label="关联对象"
                value={draft.contextValue}
                onChange={(event) => update("contextValue", event.target.value)}
                disabled={disabled || contextLoading}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">暂不关联</option>
                {contextOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {onSearchContexts ? (
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label="搜索知识点"
                    value={contextQuery}
                    placeholder="不在上面这一批？搜词或释义"
                    onChange={(event) => setContextQuery(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter belongs to this search, not to the form: the
                      // nearest submit button would save a half-written record.
                      if (event.key !== "Enter") return
                      event.preventDefault()
                      if (contextQuery.trim()) void onSearchContexts(contextQuery)
                    }}
                    disabled={disabled || contextLoading}
                    className="h-9"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="搜索"
                    disabled={disabled || contextLoading || searchingContexts || !contextQuery.trim()}
                    onClick={() => void onSearchContexts(contextQuery)}
                    className="shrink-0"
                  >
                    {searchingContexts ? "搜索中…" : "搜索"}
                  </Button>
                </div>
                {contextSearchNote ? (
                  <p role="status" className="text-xs text-muted-foreground">{contextSearchNote}</p>
                ) : null}
              </div>
            ) : null}
            <label className="grid gap-1.5 text-sm" htmlFor="qa-original-understanding">
              <span>原本理解</span>
              <Textarea
                id="qa-original-understanding"
                aria-label="原本理解"
                value={draft.original_understanding}
                onChange={(event) => update("original_understanding", event.target.value)}
                disabled={disabled}
                className="min-h-20 resize-y"
              />
            </label>
            <label className="grid gap-1.5 text-sm" htmlFor="qa-corrected-model">
              <span>纠正后的模型</span>
              <Textarea
                id="qa-corrected-model"
                aria-label="纠正后的模型"
                value={draft.corrected_model}
                onChange={(event) => update("corrected_model", event.target.value)}
                disabled={disabled}
                className="min-h-20 resize-y"
              />
            </label>
            <label className="grid gap-1.5 text-sm" htmlFor="qa-mastery-evidence">
              <span>掌握证据</span>
              <Textarea
                id="qa-mastery-evidence"
                aria-label="掌握证据"
                value={draft.mastery_evidence}
                onChange={(event) => update("mastery_evidence", event.target.value)}
                disabled={disabled}
                className="min-h-20 resize-y"
              />
            </label>
            <label className="grid gap-1.5 text-sm" htmlFor="qa-unresolved">
              <span>未解决部分</span>
              <Textarea
                id="qa-unresolved"
                aria-label="未解决部分"
                value={draft.unresolved}
                onChange={(event) => update("unresolved", event.target.value)}
                disabled={disabled}
                className="min-h-20 resize-y"
              />
            </label>
            <label className="grid gap-1.5 text-sm" htmlFor="qa-status">
              <span>状态</span>
              <select
                id="qa-status"
                aria-label="状态"
                value={draft.status}
                onChange={(event) => update("status", event.target.value as QARecordStatus)}
                disabled={disabled}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <Button type="submit" aria-label="保存记录" disabled={disabled} className="justify-self-start">
              {saving ? "保存中…" : "保存记录"}
            </Button>
          </form>
        ) : (
          <Button type="button" disabled>保存记录</Button>
        )}
        {/* Queued only when you ask. A 学习记录 is your own account of what you
            now understand; turning that into scheduled cards without
            confirmation would let a half-written note decide what you review
            next week. The invitation disappears once it has been accepted --
            telling you to 排进复习 above 已排进复习 would be arguing with itself. */}
        {hasSession && queueTarget && onSchedule ? (
          <section
            aria-label="回流到复习计划"
            className="mt-4 grid gap-2 rounded-xl border border-dashed px-3 py-3"
          >
            <div className="grid gap-1">
              <span className="text-sm font-medium">回流</span>
              {queueTarget.queued ? null : (
                <p className="text-xs text-muted-foreground">
                  把关联的知识点{queueTarget.label ? `「${queueTarget.label}」` : ""}排进复习计划，让调度去考你。
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {queueTarget.queued ? (
                <span role="status" className="text-xs text-muted-foreground">
                  {queuePromptCount > 0 ? `已排进复习 · ${queuePromptCount} 张卡` : "已经在复习计划里"}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="排进复习"
                  disabled={queueScheduling}
                  onClick={() => void onSchedule(queueTarget.knowledgeId)}
                >
                  {queueScheduling ? "正在排进…" : "排进复习"}
                </Button>
              )}
            </div>
            {queueError ? <p role="alert" className="text-xs text-destructive">{queueError}</p> : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}
