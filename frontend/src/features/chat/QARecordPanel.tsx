import { useState } from "react"

import type { QARecord, QARecordContextType, QARecordInput, QARecordStatus } from "@/api/chat"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
}

export interface QAContextOption {
  value: string
  label: string
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
}: QARecordPanelProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initialRecord, prefill))
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
      </CardContent>
    </Card>
  )
}
