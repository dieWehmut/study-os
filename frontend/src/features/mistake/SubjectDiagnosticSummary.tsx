import type { KeyboardEvent } from "react"

import { Badge } from "@/components/ui/badge"
import {
  SUBJECT_DIAGNOSTIC_ORDER,
  type SubjectDiagnosticSummary as SubjectDiagnosticSummaryData,
} from "@/lib/mistake-diagnostics"
import { subjectName } from "@/lib/subjects"
import { cn } from "@/lib/utils"

export interface SubjectDiagnosticSummaryProps {
  summaries: SubjectDiagnosticSummaryData[]
  activeSubject: string
  onSelectSubject?: (subject: string) => void
}

function evidenceLabel(summary: SubjectDiagnosticSummaryData): string {
  if (summary.evidenceTotal <= 0) return "证据 —"
  return `证据 ${summary.evidenceCompleted}/${summary.evidenceTotal}`
}

function countLabel(count: number, noun: string): string {
  return `${noun} ${count}`
}

function SubjectRow({
  summary,
  subject,
  active,
  onSelect,
}: {
  summary: SubjectDiagnosticSummaryData
  subject: string
  active: boolean
  onSelect?: (subject: string) => void
}) {
  const interactive = Boolean(onSelect)

  function activate() {
    onSelect?.(subject)
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!interactive || (event.key !== "Enter" && event.key !== " ")) return
    event.preventDefault()
    activate()
  }

  return (
    <article
      data-testid="subject-diagnostic-row"
      data-subject={subject}
      data-subject-id={subject}
      data-slot="subject-diagnostic-row"
      aria-current={active ? "true" : "false"}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? activate : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      className={cn(
        "grid gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors sm:grid-cols-[minmax(5rem,0.8fr)_minmax(11rem,1.7fr)_minmax(10rem,1.5fr)_minmax(10rem,1fr)] sm:items-center sm:gap-3",
        interactive && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary/60 bg-primary/8 shadow-sm"
          : "border-border/70 bg-card/60 hover:bg-muted/45",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", summary.total > 0 ? "bg-amber-500" : "bg-muted-foreground/30")} />
        <h3 className="truncate font-medium">{summary.label || subjectName(subject)}</h3>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" aria-label={`${summary.label || subjectName(subject)}统计`}>
        <Badge variant={summary.total > 0 ? "secondary" : "outline"}>{countLabel(summary.total, "错题")}</Badge>
        <Badge variant={summary.corrected > 0 ? "default" : "outline"}>{countLabel(summary.corrected, "订正")}</Badge>
        <Badge variant={summary.evidenceCompleted > 0 ? "secondary" : "outline"}>{evidenceLabel(summary)}</Badge>
      </div>

      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">首要错因</p>
        <p className="truncate font-medium">{summary.topCauseLabel || "暂无错因"}</p>
      </div>

      <div className="min-w-0 text-xs">
        <p className="truncate text-muted-foreground">行动建议</p>
        <p className="truncate font-medium text-foreground/85">{summary.action || "先记录一次错因"}</p>
      </div>
    </article>
  )
}

export function SubjectDiagnosticSummary({
  summaries,
  activeSubject,
  onSelectSubject,
}: SubjectDiagnosticSummaryProps) {
  const summaryBySubject = new Map(summaries.map((summary) => [summary.subject, summary]))

  return (
    <section aria-labelledby="subject-diagnostic-summary-title" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="subject-diagnostic-summary-title" className="text-base font-semibold">六科诊断总览</h2>
          <p className="text-xs text-muted-foreground">每科都保留自己的错因、证据和下一步。</p>
        </div>
        {activeSubject !== "all" ? <Badge variant="outline">当前：{summaryBySubject.get(activeSubject)?.label ?? subjectName(activeSubject)}</Badge> : null}
      </div>

      <div className="grid gap-2" aria-label="六科诊断">
        {SUBJECT_DIAGNOSTIC_ORDER.map((subject) => {
          const summary = summaryBySubject.get(subject) ?? {
            subject,
            label: subjectName(subject),
            total: 0,
            corrected: 0,
            evidenceTotal: 0,
            evidenceCompleted: 0,
            topCause: null,
            topCauseLabel: null,
            action: null,
            toolReadyCount: 0,
          }
          return (
            <SubjectRow
              key={subject}
              subject={subject}
              summary={summary}
              active={activeSubject === subject}
              onSelect={onSelectSubject}
            />
          )
        })}
      </div>
    </section>
  )
}
