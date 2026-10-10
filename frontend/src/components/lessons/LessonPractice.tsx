import { CircleHelp } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"

import { dumpThought } from "@/api/chat"
import {
  listLessonPracticeAttempts,
  submitLessonPracticeAttempt,
  type LessonPracticeAttempt,
} from "@/api/lesson-practice"
import { scheduleKnowledge } from "@/api/knowledge"
import type { LessonSection } from "@/api/lessons"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { failureMessage } from "@/lib/errors"
import { practiceNote } from "@/lib/review-note"
import { cn } from "@/lib/utils"

interface PracticeContent {
  /** Which question of the section this is, when the document names them. */
  id?: string
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

type PracticeHistoryState = "loading" | "ready" | "empty" | "error"

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

// practiceQuestions answers "what does this section ask?".
//
// A section may carry several questions in `questions`, and those are the source
// when present: reading only the flat `question` field left such a section
// rendering as if it had no question at all. The flat shape stays the
// single-question case, so an older document takes the path it always did.
function practiceQuestions(section: LessonSection): PracticeContent[] {
  const content = sectionContent(section)
  if (!content || typeof content !== "object" || Array.isArray(content)) return []
  const record = content as Record<string, unknown>
  if (Array.isArray(record.questions) && record.questions.length > 0) {
    return record.questions
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map(parseContentRecord)
      .filter((parsed): parsed is PracticeContent => parsed !== null)
  }
  const single = parseContentRecord(record)
  return single ? [single] : []
}

function parseContentRecord(record: Record<string, unknown>): PracticeContent | null {
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
    id: textField(record, ["id"]),
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
      {/* One sentence, not two: when the section is empty this line already
          says it, and the generic "这一节还没有内容" above it said the same
          thing in different words. */}
      <p className="text-xs text-muted-foreground">这道练习暂时没有可交互的选项。</p>
    </>
  )
}

export default function LessonPractice({ section, lessonID }: LessonPracticeProps) {
  const type = sectionType(section)
  const questions = practiceQuestions(section)
  const [historyState, setHistoryState] = useState<PracticeHistoryState>(lessonID ? "loading" : "empty")
  const [historyCount, setHistoryCount] = useState(0)
  const [latestAttempt, setLatestAttempt] = useState<LessonPracticeAttempt | null>(null)
  // One verdict per question, filled in as each is answered: the section's own
  // tally, which the single-question case never needed to draw.
  const [verdicts, setVerdicts] = useState<Record<number, PracticeResult["kind"]>>({})
  const historyRequest = useRef(0)

  useEffect(() => {
    let active = true
    const requestID = ++historyRequest.current
    if (!lessonID) {
      queueMicrotask(() => {
        if (!active) return
        setHistoryState("empty")
        setHistoryCount(0)
        setLatestAttempt(null)
      })
      return () => {
        active = false
      }
    }

    queueMicrotask(() => {
      if (!active || requestID !== historyRequest.current) return
      setHistoryState("loading")
      setHistoryCount(0)
      setLatestAttempt(null)
    })
    void listLessonPracticeAttempts(lessonID, section.id)
      .then((history) => {
        if (!active || requestID !== historyRequest.current) return
        const latest = history.items[0] ?? null
        setHistoryCount(Math.max(history.count, history.items.length))
        setLatestAttempt(latest)
        setHistoryState(latest ? "ready" : "empty")
      })
      .catch(() => {
        if (!active || requestID !== historyRequest.current) return
        setHistoryState("error")
        setHistoryCount(0)
        setLatestAttempt(null)
      })

    return () => {
      active = false
    }
  }, [lessonID, section.id])

  const articleID = `lesson-practice-${section.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  const answered = Object.keys(verdicts).length
  const correct = Object.values(verdicts).filter((kind) => kind === "correct").length

  return (
    <article
      data-section-kind={type}
      data-practice-mode={questions.length > 0 ? "interactive" : "legacy"}
      data-practice-history={historyState}
      data-practice-question-count={questions.length}
      className="grid gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CircleHelp aria-hidden="true" className="size-4 text-primary" />
        <h2 className="font-heading text-lg font-semibold">{section.title || sectionLabels[type] || type}</h2>
        {section.required ? <Badge variant="outline">必看</Badge> : null}
      </div>

      {questions.length > 0 ? (
        <div className="grid gap-4">
          {lessonID && historyState === "loading" ? (
            <p className="text-xs text-muted-foreground">正在读取练习记录…</p>
          ) : null}
          {lessonID && historyState === "ready" && historyCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {/* The history is one list for the section, so with several questions
                  it cannot claim to be this question's count. */}
              <span>{questions.length > 1 ? `本节已作答 ${historyCount} 次` : `已作答 ${historyCount} 次`}</span>
              {latestAttempt && latestAttempt.elapsed_ms > 0
                ? ` · 最近一次用时 ${Math.max(1, Math.round(latestAttempt.elapsed_ms / 1000))} 秒`
                : null}
            </p>
          ) : null}
          {questions.map((question, index) => (
            <PracticeQuestionForm
              key={question.id || `question-${index}`}
              question={question}
              index={index}
              total={questions.length}
              articleID={articleID}
              lessonID={lessonID}
              sectionID={section.id}
              // Only the single-question case can show it: the history list is one
              // list for the section, so it does not say which question it belongs
              // to once there are several.
              latestAttempt={questions.length === 1 ? latestAttempt : null}
              onSettled={(kind) => {
                setVerdicts((current) => ({ ...current, [index]: kind }))
                setHistoryCount((count) => count + 1)
                setHistoryState("ready")
              }}
            />
          ))}
          {questions.length > 1 && answered > 0 ? (
            <p role="status" className="text-xs text-muted-foreground">
              {`本节已作答 ${answered}/${questions.length} 道，答对 ${correct} 道。`}
            </p>
          ) : null}
        </div>
      ) : (
        <LegacyPractice section={section} />
      )}
    </article>
  )
}

/**
 * One question of a practice section, with its own answer, verdict and evidence.
 *
 * Extracted from the section component so a section can ask several: the state was
 * one answer's worth (selected, submitted, result…), and sharing it across
 * questions would have the second overwrite the first.
 */
function PracticeQuestionForm({
  question,
  index,
  total,
  articleID,
  lessonID,
  sectionID,
  latestAttempt,
  onSettled,
}: {
  question: PracticeContent
  index: number
  total: number
  articleID: string
  lessonID?: string
  sectionID: string
  latestAttempt?: LessonPracticeAttempt | null
  onSettled: (kind: PracticeResult["kind"]) => void
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<PracticeResult | null>(null)
  const [evidenceState, setEvidenceState] = useState<"idle" | "saving" | "saved" | "failed">("idle")
  // 收进知识库: a wrong answer that only leaves an attempt behind is a mistake the
  // reader will make again. Filing it puts the question back in front of them.
  const [intakeState, setIntakeState] = useState<"idle" | "saving" | "saved">("idle")
  const [intakeError, setIntakeError] = useState("")
  // This question's own history, when the section asks several: the section's
  // number is a total, and "answered 3 times" would otherwise read as this one.
  const [ownCount, setOwnCount] = useState<number | null>(null)
  const startedAt = useRef(clockNow())

  useEffect(() => {
    if (!lessonID || total < 2 || !question.id) return
    let active = true
    void listLessonPracticeAttempts(lessonID, sectionID, question.id)
      .then((history) => {
        if (active) setOwnCount(Math.max(history.count, history.items.length))
      })
      .catch(() => {
        // The count is a convenience; the question is still answerable without it.
      })
    return () => {
      active = false
    }
  }, [lessonID, question.id, sectionID, total])

  const suffix = total > 1 ? `-q${index + 1}` : ""
  const questionID = `${articleID}-question${suffix}`
  const groupName = `${articleID}-options${suffix}`
  const visibleResult = result ?? (!submitted && latestAttempt ? resultFromAttempt(latestAttempt) : null)

  async function submit() {
    if (selected === null || submitted) return
    const optimisticResult = resultFor(question, selected)
    setResult(optimisticResult)
    setSubmitted(true)
    setIntakeState("idle")
    setIntakeError("")
    // The tally counts this question as soon as the reader sees a verdict; the
    // server's answer replaces it below if the two disagree.
    onSettled(optimisticResult.kind)
    if (!lessonID) return

    setEvidenceState("saving")
    try {
      const attempt = await submitLessonPracticeAttempt(lessonID, sectionID, {
        answer: question.options[selected],
        questionId: question.id,
        elapsedMs: Math.max(0, Math.round(clockNow() - startedAt.current)),
      })
      const settled = resultFromAttempt(attempt)
      setResult(settled)
      onSettled(settled.kind)
      setEvidenceState("saved")
    } catch {
      setEvidenceState("failed")
    }
  }

  async function fileMistake() {
    if (selected === null || intakeState === "saving") return
    setIntakeState("saving")
    setIntakeError("")
    try {
      const item = await dumpThought(
        practiceNote({
          question: question.question,
          answerLabel: question.answerLabel,
          picked: question.options[selected] ?? "",
          explanation: question.explanation,
        }),
      )
      // Queued as well as filed: a mistake that never comes back is just a record.
      await scheduleKnowledge(item.id)
      setIntakeState("saved")
    } catch (reason) {
      setIntakeState("idle")
      setIntakeError(failureMessage(reason, "收进知识库失败"))
    }
  }

  return (
    <form
      className="grid gap-4 rounded-lg border border-border/70 bg-background/40 p-3"
      data-practice-question={index + 1}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p id={questionID} className="text-sm leading-7 text-foreground/90">
        {total > 1 ? <span className="mr-1 text-xs text-muted-foreground">{`第 ${index + 1} 题`}</span> : null}
        {question.question}
      </p>
      {ownCount !== null && ownCount > 0 ? (
        <p className="text-xs text-muted-foreground">{`这题已作答 ${ownCount} 次`}</p>
      ) : null}
      <fieldset className="grid gap-2" aria-describedby={questionID}>
            <legend className="sr-only">选择答案</legend>
            {question.options.map((option, optionIndex) => (
              <label
                key={`${option}-${optionIndex}`}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm transition-colors hover:bg-muted/70",
                  selected === optionIndex && "border-primary bg-primary/5",
                  submitted && "cursor-default opacity-80",
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={String(optionIndex)}
                  checked={selected === optionIndex}
                  disabled={submitted}
                  onChange={() => setSelected(optionIndex)}
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
          {visibleResult ? (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "grid gap-2 rounded-lg border p-3 text-sm",
                visibleResult.kind === "correct" && "border-primary/30 bg-primary/5",
                visibleResult.kind === "incorrect" && "border-destructive/30 bg-destructive/5",
                visibleResult.kind === "ungraded" && "border-border bg-muted/40",
              )}
            >
              <p className="font-medium">{visibleResult.label}</p>
              <p className="leading-6">{visibleResult.feedback}</p>
              {visibleResult.referenceAnswer ? (
                <p className="text-muted-foreground">参考答案：{visibleResult.referenceAnswer}</p>
              ) : null}
            </div>
          ) : null}
          {/* Only after a wrong answer: a card for something already known is
              noise in the queue. */}
          {submitted && visibleResult?.kind === "incorrect" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                收进知识库会把这道题作为卡片排进复习——答错的题，明天再问一次。
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={intakeState === "saving" || intakeState === "saved"}
                onClick={() => void fileMistake()}
              >
                {intakeState === "saved" ? "已收进知识库" : intakeState === "saving" ? "正在保存…" : "收进知识库"}
              </Button>
              {intakeState === "saved" ? (
                <>
                  <Link to="/memory" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    去记忆
                  </Link>
                  <Link to="/knowledge" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    去知识库
                  </Link>
                </>
              ) : null}
              {intakeError ? (
                <p role="alert" className="text-xs text-destructive">
                  {intakeError}
                </p>
              ) : null}
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
  )
}
