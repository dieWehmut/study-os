import { CircleHelp } from "lucide-react"
import { useRef, useState } from "react"

import { submitLessonPracticeAttempt, type LessonPracticeAttempt } from "@/api/lesson-practice"
import type { LessonSection } from "@/api/lessons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PracticeContent {
  question: string
  options: string[]
  answer?: unknown
  explanation?: string
  feedback?: string
  correctFeedback?: string
  incorrectFeedback?: string
  answerLabel?: string
}

interface PracticeResult {
  kind: "correct" | "incorrect" | "ungraded"
  label: string
  feedback: string
  referenceAnswer?: string
}

export interface LessonPracticeProps {
  section: LessonSection
  lessonID?: string
}

const sectionLabels: Record<string, string> = {
  practice: "马上练一题",
  quiz: "马上练一题",
}

function sectionType(section: LessonSection): string {
  return section.type || section.kind || "practice"
}

function sectionContent(section: LessonSection): unknown {
  if (section.content !== undefined) return section.content
  if (section.body !== undefined) return section.body
  if (section.markdown !== undefined) return section.markdown
  if (section.summary !== undefined) return section.summary
  return ""
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function optionValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim()
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of ["label", "text", "value", "title"]) {
      const candidate = stringValue(record[key])
      if (candidate) return candidate
    }
  }
  return ""
}

function optionValues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(optionValue).filter(Boolean)
}

function answerValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(answerValues)
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of ["value", "index", "answer", "correct_answer"]) {
      if (record[key] !== undefined) return answerValues(record[key])
    }
    return []
  }
  return value === undefined || value === null ? [] : [value]
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function answerIndex(answer: unknown, options: string[]): number | null {
  for (const candidate of answerValues(answer)) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) {
      if (candidate >= 0 && candidate < options.length) return candidate
      if (candidate >= 1 && candidate <= options.length) return candidate - 1
    }

    const text = optionValue(candidate)
    const match = options.findIndex((option) => normalized(option) === normalized(text))
    if (match >= 0) return match

    if (/^[a-z]$/i.test(text)) {
      const index = text.toUpperCase().charCodeAt(0) - "A".charCodeAt(0)
      if (index >= 0 && index < options.length) return index
    }
  }
  return null
}

function textField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = stringValue(record[key])
    if (value) return value
  }
  return ""
}

function parseContent(section: LessonSection): PracticeContent | null {
  const content = sectionContent(section)
  if (!content || typeof content !== "object" || Array.isArray(content)) return null

  const record = content as Record<string, unknown>
  const question = textField(record, ["question", "prompt", "stem"])
  const options = optionValues(record.options)
  if (!question || options.length === 0) return null

  const answer = record.answer !== undefined ? record.answer : record.correct_answer
  const answerText = answerValues(answer).map(optionValue).find(Boolean)
  const feedbackValue = record.feedback
  const feedbackRecord = feedbackValue && typeof feedbackValue === "object" && !Array.isArray(feedbackValue)
    ? feedbackValue as Record<string, unknown>
    : undefined
  return {
    question,
    options,
    answer,
    explanation: textField(record, ["explanation", "rationale"]),
    feedback: typeof feedbackValue === "string"
      ? feedbackValue.trim()
      : feedbackRecord
        ? textField(feedbackRecord, ["text", "body", "default"])
        : "",
    correctFeedback: textField(record, ["correct_feedback", "correctFeedback"]),
    incorrectFeedback: textField(record, ["incorrect_feedback", "incorrectFeedback"]),
    answerLabel: answerText,
  }
}

function legacyText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join("\n")
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return textField(record, ["text", "body", "markdown", "summary", "question"])
  }
  return ""
}

function legacyItems(section: LessonSection): string[] {
  if (section.items?.length) return section.items
  const content = sectionContent(section)
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const record = content as Record<string, unknown>
    const items = record.items ?? record.options
    if (Array.isArray(items)) return items.map(optionValue).filter(Boolean)
  }
  return []
}

function resultFor(content: PracticeContent, selected: number): PracticeResult {
  const correct = answerIndex(content.answer, content.options)
  if (correct === null) {
    const feedback = content.feedback || content.explanation || "请对照反馈复盘。"
    return {
      kind: "ungraded",
      label: "已提交",
      feedback: `暂无标准答案。${feedback}`,
    }
  }

  const isCorrect = selected === correct
  const feedback = isCorrect
    ? content.correctFeedback || content.feedback || content.explanation || "这次选对了。"
    : content.incorrectFeedback || content.feedback || content.explanation || "再检查题目中的条件，然后重做一次。"
  return {
    kind: isCorrect ? "correct" : "incorrect",
    label: isCorrect ? "回答正确" : "回答不正确",
    feedback,
    referenceAnswer: isCorrect ? undefined : content.options[correct] || content.answerLabel,
  }
}

function resultFromAttempt(attempt: LessonPracticeAttempt): PracticeResult {
  const kind = attempt.evaluation
  if (kind === "correct") {
    return {
      kind,
      label: "回答正确",
      feedback: attempt.feedback || "回答正确。",
    }
  }
  if (kind === "incorrect") {
    return {
      kind,
      label: "回答不正确",
      feedback: attempt.feedback || "请检查题目条件后再试。",
      referenceAnswer: attempt.reference_answer || undefined,
    }
  }
  return {
    kind: "ungraded",
    label: "已提交",
    feedback: attempt.feedback || "暂无标准答案，请对照反馈复盘。",
  }
}

function clockNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

function LegacyPractice({ section }: LessonPracticeProps) {
  const text = legacyText(sectionContent(section))
  const items = legacyItems(section)
  return (
    <>
      {text ? <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{text}</p> : null}
      {items.length > 0 ? (
        <ol className="grid gap-2 pl-5 text-sm leading-6 marker:text-muted-foreground">
          {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ol>
      ) : null}
      {!text && items.length === 0 ? <p className="text-sm text-muted-foreground">这一节还没有内容。</p> : null}
      <p className="text-xs text-muted-foreground">这道练习暂时没有可交互的选项。</p>
    </>
  )
}

export default function LessonPractice({ section, lessonID }: LessonPracticeProps) {
  const type = sectionType(section)
  const content = parseContent(section)
  const [selected, setSelected] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<PracticeResult | null>(null)
  const [evidenceState, setEvidenceState] = useState<"idle" | "saving" | "saved" | "failed">("idle")
  const startedAt = useRef(clockNow())

  async function submit() {
    if (selected === null || submitted) return
    if (!content) return
    const optimisticResult = resultFor(content, selected)
    setResult(optimisticResult)
    setSubmitted(true)
    if (!lessonID) return

    setEvidenceState("saving")
    try {
      const attempt = await submitLessonPracticeAttempt(lessonID, section.id, {
        answer: content.options[selected],
        elapsedMs: Math.max(0, Math.round(clockNow() - startedAt.current)),
      })
      setResult(resultFromAttempt(attempt))
      setEvidenceState("saved")
    } catch {
      setEvidenceState("failed")
    }
  }
  const articleID = `lesson-practice-${section.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  const questionID = `${articleID}-question`
  const groupName = `${articleID}-options`

  return (
    <article
      data-section-kind={type}
      data-practice-mode={content ? "interactive" : "legacy"}
      className="grid gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CircleHelp aria-hidden="true" className="size-4 text-primary" />
        <h2 className="font-heading text-lg font-semibold">{section.title || sectionLabels[type] || type}</h2>
        {section.required ? <Badge variant="outline">必看</Badge> : null}
      </div>

      {content ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <p id={questionID} className="text-sm leading-7 text-foreground/90">{content.question}</p>
          <fieldset className="grid gap-2" aria-describedby={questionID}>
            <legend className="sr-only">选择答案</legend>
            {content.options.map((option, index) => (
              <label
                key={`${option}-${index}`}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm transition-colors hover:bg-muted/70",
                  selected === index && "border-primary bg-primary/5",
                  submitted && "cursor-default opacity-80",
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={String(index)}
                  checked={selected === index}
                  disabled={submitted}
                  onChange={() => setSelected(index)}
                  className="size-4 accent-primary"
                />
                <span>{option}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">先选一个答案，再提交；提交后会显示即时反馈。</p>
            <Button type="submit" disabled={selected === null || submitted}>提交答案</Button>
          </div>
          {result ? (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "grid gap-2 rounded-lg border p-3 text-sm",
                result.kind === "correct" && "border-primary/30 bg-primary/5",
                result.kind === "incorrect" && "border-destructive/30 bg-destructive/5",
                result.kind === "ungraded" && "border-border bg-muted/40",
              )}
            >
              <p className="font-medium">{result.label}</p>
              <p className="leading-6">{result.feedback}</p>
              {result.referenceAnswer ? <p className="text-muted-foreground">参考答案：{result.referenceAnswer}</p> : null}
            </div>
          ) : null}
          {lessonID && evidenceState !== "idle" ? (
            <p
              data-evidence-state={evidenceState}
              aria-live="polite"
              className={cn(
                "text-xs",
                evidenceState === "failed" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {evidenceState === "saving" ? "正在保存答题证据…" : null}
              {evidenceState === "saved" ? "已保存答题证据" : null}
              {evidenceState === "failed" ? "答题反馈已显示，但证据保存失败。" : null}
            </p>
          ) : null}
        </form>
      ) : (
        <LegacyPractice section={section} />
      )}
    </article>
  )
}
