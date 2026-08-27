import { useState } from "react"
import { LoaderCircle, Tags } from "lucide-react"

import { listErrorCauses, type ErrorCause } from "@/api/error-causes"
import { reclassifyMistake } from "@/api/mistakes"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import type { MistakeRecord } from "@/lib/mistakes"

export interface MistakeCauseEditorProps {
  record: MistakeRecord
  onSaved?: (record: MistakeRecord, cause: ErrorCause) => void
}

function describe(prefix: string, reason: unknown): string {
  const detail = reason instanceof Error ? reason.message.trim() : ""
  return detail ? `${prefix}：${detail}` : prefix
}

function applicableCauses(record: MistakeRecord, loaded: ErrorCause[]): ErrorCause[] {
  const subject = record.subject.trim().toLowerCase()
  const current = record.cause.trim().toLowerCase()
  const unique = new Map<string, ErrorCause>()

  for (const cause of loaded) {
    const causeSubject = cause.subject.trim().toLowerCase()
    if (cause.status !== "confirmed" || (causeSubject && causeSubject !== subject)) continue
    if (cause.id.trim().toLowerCase() === current) continue
    unique.set(cause.id, cause)
  }

  return [...unique.values()]
}

export function MistakeCauseEditor({ record, onSaved }: MistakeCauseEditorProps) {
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [causes, setCauses] = useState<ErrorCause[]>([])
  const [selected, setSelected] = useState("")
  const [error, setError] = useState("")

  async function openEditor() {
    setEditing(true)
    setLoading(true)
    setSelected("")
    setCauses([])
    setError("")
    try {
      const loaded = await listErrorCauses({
        subject: record.subject.trim().toLowerCase(),
        status: "confirmed",
      })
      setCauses(applicableCauses(record, loaded))
    } catch (reason) {
      setError(describe("读取错因失败", reason))
    } finally {
      setLoading(false)
    }
  }

  function cancel() {
    if (saving) return
    setEditing(false)
    setSelected("")
    setCauses([])
    setError("")
  }

  async function save() {
    if (!selected || saving) return
    setSaving(true)
    setError("")
    try {
      const updated = await reclassifyMistake(record.id, selected)
      const chosen = causes.find((cause) => cause.id === selected)
      if (chosen) onSaved?.(updated, chosen)
      setEditing(false)
      setSelected("")
      setCauses([])
    } catch (reason) {
      setError(describe("重新归类失败", reason))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => void openEditor()}>
        <Tags aria-hidden="true" />
        重新归类
      </Button>
    )
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2" aria-busy={loading || saving}>
      {loading ? (
        <p role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
          正在读取错因…
        </p>
      ) : causes.length > 0 ? (
        <Select
          ariaLabel="新错因"
          value={selected}
          onValueChange={(value) => {
            setSelected(value)
            setError("")
          }}
          options={causes.map((cause) => ({ value: cause.id, label: cause.label }))}
          placeholder="选择新错因"
          className="min-w-44"
          disabled={saving}
        />
      ) : error ? null : (
        <p className="text-xs text-muted-foreground">没有可用的已确认错因。</p>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {!loading && causes.length > 0 ? (
          <Button type="button" size="sm" disabled={!selected || saving} onClick={() => void save()}>
            {saving ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
            {saving ? "保存中…" : "保存归类"}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={cancel}>
          取消
        </Button>
      </div>

      {error ? <p role="alert" className="w-full text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
