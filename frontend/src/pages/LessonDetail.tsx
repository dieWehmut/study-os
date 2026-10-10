import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, BookOpenCheck, CheckCircle2, CircleHelp, Clock3, Download, FileText, History, Pencil, RotateCcw } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router-dom"

import {
  getLesson,
  LESSON_SECTION_ORDER,
  listLessonVersions,
  updateLesson,
  type Lesson,
  type LessonSection,
  type LessonVersionSummary,
} from "@/api/lessons"
import { ApiError } from "@/api/client"
import { saveTextFile } from "@/lib/download"
import { lessonToMarkdown } from "@/lib/lesson-markdown"
import { failureMessage } from "@/lib/errors"
import { Badge } from "@/components/ui/badge"
import LessonPractice from "@/components/lessons/LessonPractice"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  blankPracticeDraft,
  isEditableSection,
  practiceContentFromDraft,
  practiceDraftFromSection,
  practiceOptions,
  sectionContentFromText,
  sectionContentKind,
  sectionEditorText,
  sectionHasContent,
  sectionItems,
  sectionText,
  type LessonPracticeDraft,
  type LessonPracticeDraftFields,
} from "@/lib/lesson-content"
import { changedSections, compareLessonSections, describeChange, type LessonSectionDiff } from "@/lib/lesson-diff"
import { subjectName, SUBJECTS } from "@/lib/subjects"
import { cn } from "@/lib/utils"

const sectionLabels: Record<string, string> = {
  diagnostic: "开始前",
  objectives: "学习目标",
  concept: "核心概念",
  examples: "例子",
  visualization: "图示与结构",
  practice: "马上练一题",
  feedback: "反馈与纠正",
  summary: "一句话总结",
  memory: "记忆确认",
  follow_up: "下一步",
}

const statusLabels: Record<string, string> = {
  draft: "草稿",
  reviewed: "已审核",
  published: "已发布",
  archived: "已归档",
}

function statusLabel(status: string): string {
  return statusLabels[status] ?? status
}

function formatMoment(value: string): string {
  if (!value) return "时间未知"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN")
}

function sectionType(section: LessonSection): string {
  return section.type || section.kind || "concept"
}

function objectivesForLesson(lesson: Lesson): string[] {
  if (lesson.objectives?.length) return lesson.objectives

  const section = lesson.sections.find((candidate) => sectionType(candidate) === "objectives")
  if (!section) return []

  const items = sectionItems(section)
  if (items.length > 0) return items

  const text = sectionText(section).trim()
  return text ? [text] : []
}

function sourceLabel(lesson: Lesson): string {
  const title = lesson.source?.title || lesson.source_id || lesson.source_type
  if (!title) return "未关联资料"
  const locator = lesson.source?.locator
  return locator ? `${title} · ${locator}` : title
}

function sortSections(sections: LessonSection[]): LessonSection[] {
  return [...sections].sort((left, right) => {
    const leftType = sectionType(left)
    const rightType = sectionType(right)
    const leftIndex = LESSON_SECTION_ORDER.indexOf(leftType as (typeof LESSON_SECTION_ORDER)[number])
    const rightIndex = LESSON_SECTION_ORDER.indexOf(rightType as (typeof LESSON_SECTION_ORDER)[number])
    const normalizedLeft = leftIndex === -1 ? LESSON_SECTION_ORDER.length : leftIndex
    const normalizedRight = rightIndex === -1 ? LESSON_SECTION_ORDER.length : rightIndex
    if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight
    return (left.position ?? 0) - (right.position ?? 0)
  })
}

function SectionView({
  lessonID,
  section,
  editing,
  draft,
  onDraftChange,
}: {
  lessonID: string
  section: LessonSection
  editing: boolean
  draft: string
  onDraftChange: (value: string) => void
}) {
  const type = sectionType(section)
  if (type === "practice") return <LessonPractice lessonID={lessonID} section={section} />

  const title = section.title || sectionLabels[type] || type
  const isQuiz = type === "quiz"

  // Editing is a textarea per section, empty ones included: filling in a draft
  // is exactly what this is for, and a section with no content has no card to
  // click otherwise.
  if (editing && isEditableSection(section)) {
    const kind = sectionContentKind(section)
    return (
      <article data-section-kind={type} className="grid gap-3 rounded-xl border border-primary/35 bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
          <h2 className="font-heading text-lg font-semibold">{title}</h2>
          {section.required ? <Badge variant="outline">必看</Badge> : null}
          <span className="ml-auto text-xs text-muted-foreground">
            {kind === "items" ? "一行一条" : kind === "markdown" ? "支持 Markdown" : "一段文字"}
          </span>
        </div>
        <textarea
          aria-label={`${title}内容`}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          className="min-h-24 resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
        />
      </article>
    )
  }

  const text = sectionText(section)
  const items = sectionItems(section)

  // An empty section is one line of the outline, not a card of its own. A draft
  // is ten of them at once, and ten identical "还没有内容" panels pushed the one
  // thing worth seeing -- the shape of the lesson -- off the screen.
  if (!sectionHasContent(section)) {
    return (
      <article
        data-section-kind={type}
        data-section-empty="true"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border/70 px-4 py-2.5"
      >
        <CheckCircle2 aria-hidden="true" className="size-4 text-muted-foreground" />
        <h2 className="font-heading text-base font-medium text-muted-foreground">{title}</h2>
        {section.required ? <Badge variant="outline">必看</Badge> : null}
        <span className="ml-auto text-xs text-muted-foreground">还没有内容</span>
      </article>
    )
  }

  return (
    <article data-section-kind={type} className="grid gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {isQuiz ? <CircleHelp aria-hidden="true" className="size-4 text-primary" /> : <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />}
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {section.required ? <Badge variant="outline">必看</Badge> : null}
      </div>
      {text ? <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{text}</p> : null}
      {items.length > 0 ? (
        <ol className="grid gap-2 pl-5 text-sm leading-6 marker:text-muted-foreground">
          {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ol>
      ) : null}
    </article>
  )
}

/**
 * 即时练习 as fields.
 *
 * The answer key is a select over the options, not a text box: a key that matches
 * no option grades every attempt wrong while looking finished. A question with no
 * key is allowed -- the server marks those 未评分 rather than pretending.
 */
function PracticeSectionEditor({
  section,
  draft,
  onChange,
}: {
  section: LessonSection
  draft: LessonPracticeDraft
  onChange: (draft: LessonPracticeDraft) => void
}) {
  const options = practiceOptions(draft)
  const field = "min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
  return (
    <article data-section-kind="practice" className="grid gap-3 rounded-xl border border-primary/35 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <CircleHelp aria-hidden="true" className="size-4 text-primary" />
        <h2 className="font-heading text-lg font-semibold">{section.title || "即时练习"}</h2>
        {section.required ? <Badge variant="outline">必看</Badge> : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {options.length > 0 ? `${options.length} 个选项` : "一行一个选项"}
        </span>
      </div>

      <label className="grid gap-1 text-sm font-medium">
        题干
        <textarea
          aria-label="练习题干"
          value={draft.question}
          onChange={(event) => onChange({ ...draft, question: event.target.value })}
          placeholder="若 m = 4 kg、a = 2 m/s²，F 是多少？"
          className={field}
        />
      </label>

      <label className="grid gap-1 text-sm font-medium">
        选项（一行一个）
        <textarea
          aria-label="练习选项"
          value={draft.optionsText}
          onChange={(event) => {
            const optionsText = event.target.value
            // Retyping the options can leave the key naming nothing: drop it and
            // say so, rather than saving a key that cannot be matched.
            const stillThere = optionsText.split("\n").map((line) => line.trim()).includes(draft.correctAnswer)
            onChange({ ...draft, optionsText, correctAnswer: stillThere ? draft.correctAnswer : "" })
          }}
          placeholder={"2 N\n6 N\n8 N"}
          className={field}
        />
      </label>

      <div className="grid gap-1 text-sm font-medium">
        标准答案
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">先写上选项，才能选标准答案。</p>
        ) : (
          <Select
            ariaLabel="练习标准答案"
            value={draft.correctAnswer}
            onValueChange={(value) => onChange({ ...draft, correctAnswer: value })}
            // An unanswered key is a choice of its own, not an empty field.
            placeholder="未评分（不给答案）"
            options={[
              { value: "", label: "未评分（不给答案）" },
              ...options.map((option) => ({ value: option, label: option })),
            ]}
          />
        )}
        {options.length > 0 && draft.correctAnswer === "" ? (
          <p className="text-xs text-muted-foreground">不给答案时，这门课的练习会按「未评分」处理。</p>
        ) : null}
      </div>

      <label className="grid gap-1 text-sm font-medium">
        解析（可选）
        <textarea
          aria-label="练习解析"
          value={draft.explanation}
          onChange={(event) => onChange({ ...draft, explanation: event.target.value })}
          placeholder="F = ma，所以 8 N。"
          className={field}
        />
      </label>

      {(draft.more ?? []).map((question, index) => (
        <div key={`practice-question-${index}`} className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{`第 ${index + 2} 题`}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`删除第 ${index + 2} 题`}
              onClick={() => onChange({ ...draft, more: (draft.more ?? []).filter((_, position) => position !== index) })}
            >
              删除这题
            </Button>
          </div>
          <label className="grid gap-1 text-sm font-medium">
            题干
            <textarea
              aria-label={`第 ${index + 2} 题题干`}
              value={question.question}
              onChange={(event) => onChange(updateExtraQuestion(draft, index, { ...question, question: event.target.value }))}
              className={field}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            选项（一行一个）
            <textarea
              aria-label={`第 ${index + 2} 题选项`}
              value={question.optionsText}
              onChange={(event) => onChange(updateExtraQuestion(draft, index, retypedOptions(question, event.target.value)))}
              className={field}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            标准答案
            {/* The same picker as the first question: typing the exact option text by
                hand is how an answer silently stops matching an option. */}
            <Select
              ariaLabel={`第 ${index + 2} 题标准答案`}
              value={question.correctAnswer}
              onValueChange={(value) => onChange(updateExtraQuestion(draft, index, { ...question, correctAnswer: value }))}
              placeholder="未评分（不给答案）"
              options={[
                { value: "", label: "未评分（不给答案）" },
                ...question.optionsText.split("\n").map((line) => line.trim()).filter((line) => line !== "")
                  .map((option) => ({ value: option, label: option })),
              ]}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            解析（可选）
            <textarea
              aria-label={`第 ${index + 2} 题解析`}
              value={question.explanation}
              onChange={(event) => onChange(updateExtraQuestion(draft, index, { ...question, explanation: event.target.value }))}
              className={field}
            />
          </label>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...draft, more: [...(draft.more ?? []), blankPracticeDraft()] })}
        >
          再加一题
        </Button>
        <p className="text-xs text-muted-foreground">
          {/* No cap is printed here: the server owns it (models.MaxLessonPracticeQuestions),
              and a number copied into this file would drift from it. */}
          {`本节共 ${1 + (draft.more ?? []).length} 道题`}
        </p>
      </div>
    </article>
  )
}

/** Replace one of the questions after the first. */
function updateExtraQuestion(
  draft: LessonPracticeDraft,
  index: number,
  next: LessonPracticeDraftFields,
): LessonPracticeDraft {
  const more = [...(draft.more ?? [])]
  more[index] = next
  return { ...draft, more }
}

/** Retyping the options can leave the key naming nothing: drop it rather than
 *  keeping an answer that cannot be matched. */
function retypedOptions(question: LessonPracticeDraftFields, optionsText: string): LessonPracticeDraftFields {
  const stillThere = optionsText.split("\n").map((line) => line.trim()).includes(question.correctAnswer)
  return { ...question, optionsText, correctAnswer: stillThere ? question.correctAnswer : "" }
}

/** Everything the editor starts from, so opening it twice seeds the same way. */
function editorSeed(lesson: Lesson) {
  return {
    drafts: Object.fromEntries(lesson.sections.map((section) => [section.id, sectionEditorText(section)])),
    // Only the template's own practice section: a quiz-typed section may hold
    // content this editor does not understand, and rewriting it would lose it.
    practiceDrafts: Object.fromEntries(
      lesson.sections
        .filter((section) => sectionType(section) === "practice")
        .map((section) => [section.id, practiceDraftFromSection(section)]),
    ),
    title: lesson.title,
    status: lesson.status,
    subject: lesson.subject === "all" ? "" : lesson.subject,
  }
}

export default function LessonDetail() {
  const { id = "" } = useParams()
  // 新建课程 arrives with ?edit=1: a blank ten-section skeleton on a reading page
  // is a page with nothing to do on it.
  const [searchParams] = useSearchParams()
  const wantsEditing = searchParams.get("edit") === "1"
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [requestVersion, setRequestVersion] = useState(0)
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [practiceDrafts, setPracticeDrafts] = useState<Record<string, LessonPracticeDraft>>({})
  const [draftTitle, setDraftTitle] = useState("")
  const [draftStatus, setDraftStatus] = useState("draft")
  const [draftSubject, setDraftSubject] = useState("")
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const [history, setHistory] = useState<LessonVersionSummary[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  // The version the lesson is actually on, which is not `lesson.version` while an
  // older revision is on screen.
  const [currentVersion, setCurrentVersion] = useState(0)
  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  // Per version: what it changed, while it is being looked at.
  const [diffs, setDiffs] = useState<Record<number, LessonSectionDiff[] | "loading" | "error">>({})

  async function refreshHistory() {
    if (!lesson) return
    try {
      setHistory(await listLessonVersions(lesson.id))
    } catch {
      setNotice("读取版本历史失败，请确认本地后端正在运行。")
    }
  }

  async function openHistory() {
    if (!lesson) return
    setHistoryOpen(true)
    setNotice("")
    setHistory(null)
    await refreshHistory()
  }

  /**
   * Show an older revision.
   *
   * Read-only on purpose: writing from here would mean writing against a version
   * that is no longer current, and the server would (rightly) refuse it. 恢复这一版
   * is the way back, and it is a deliberate click.
   */
  async function viewVersion(version: number) {
    if (!lesson) return
    setNotice("")
    try {
      const value = await getLesson(lesson.id, version)
      setPreviewVersion(version)
      setEditing(false)
      setDrafts({})
      setLesson(value)
    } catch {
      setNotice("读取这一版失败。")
    }
  }

  async function leavePreview() {
    if (!lesson) return
    setNotice("")
    try {
      setLesson(await getLesson(lesson.id))
      setPreviewVersion(null)
    } catch {
      setNotice("回到当前版本失败。")
    }
  }

  /** Restore a revision by writing it again: versions are immutable, so the old
   * one stays in the history and the restore is itself a new version. */
  async function restoreVersion(version: number) {
    if (!lesson || saving) return
    setSaving(true)
    setNotice("")
    try {
      const [revision, current] = await Promise.all([getLesson(lesson.id, version), getLesson(lesson.id)])
      const updated = await updateLesson(lesson.id, {
        version: current.version ?? 1,
        document: { schema_version: revision.document?.schema_version ?? 1, sections: revision.sections },
      })
      setLesson(updated)
      setCurrentVersion(updated.version ?? 0)
      setPreviewVersion(null)
      setHistory(await listLessonVersions(lesson.id))
      setNotice(`已恢复第 ${version} 版 · 现在是版本 ${updated.version ?? ""}`.trim())
    } catch (failure) {
      const conflict = failure instanceof ApiError && failure.status === 409
      setNotice(conflict ? "恢复失败：这节课刚被改过，刷新后再试。" : "恢复失败，请确认本地后端正在运行。")
    } finally {
      setSaving(false)
    }
  }

  function startEditing() {
    if (!lesson) return
    const seed = editorSeed(lesson)
    setDrafts(seed.drafts)
    setPracticeDrafts(seed.practiceDrafts)
    setDraftTitle(seed.title)
    setDraftStatus(seed.status)
    setDraftSubject(seed.subject)
    // The title and the filing of the lesson are as editable as its sections: a
    // course made from a note arrives called 整合笔记, and 草稿 until someone
    // says otherwise.
    setNotice("")
    setEditing(true)
  }

  /** The lesson as a Markdown document, named the way the file should arrive. */
  function downloadMarkdown() {
    if (!lesson) return
    const name = (lesson.title.trim() || "未命名课程").replace(/[\\/:*?"<>|]/g, "-")
    saveTextFile(lessonToMarkdown(lesson), `${name}.md`, "text/markdown;charset=utf-8")
  }

  function cancelEditing() {
    setEditing(false)
    setDrafts({})
    setPracticeDrafts({})
    setNotice("")
  }

  /**
   * Write the whole document back, at the version that was read.
   *
   * The document version is immutable and the server refuses a write that is not
   * current, so the reader's own two tabs cannot silently overwrite each other.
   * A refusal says so and leaves the edits on screen rather than reloading over
   * them -- the text is the one thing here that cannot be recovered.
   */
  async function saveEdits() {
    if (!lesson || saving) return
    setSaving(true)
    setNotice("")
    try {
      const sections = lesson.sections.map((section) => {
        const practice = practiceDrafts[section.id]
        if (practice && sectionType(section) === "practice") {
          return { ...section, content: practiceContentFromDraft(practice, section) }
        }
        return drafts[section.id] !== undefined && isEditableSection(section)
          ? { ...section, content: sectionContentFromText(section, drafts[section.id]) }
          : section
      })
      const updated = await updateLesson(lesson.id, {
        version: lesson.version ?? 1,
        // The title is trimmed, and an empty one is refused rather than saved:
        // a nameless course is one nothing can be found by.
        ...(draftTitle.trim() && draftTitle.trim() !== lesson.title ? { title: draftTitle.trim() } : {}),
        ...(draftStatus !== lesson.status ? { status: draftStatus } : {}),
        ...(draftSubject !== (lesson.subject === "all" ? "" : lesson.subject) ? { subject: draftSubject } : {}),
        document: { schema_version: lesson.document?.schema_version ?? 1, sections },
      })
      setLesson(updated)
      setCurrentVersion(updated.version ?? 0)
      setEditing(false)
      setDrafts({})
      setPracticeDrafts({})
      setNotice(updated.version ? `已保存 · 版本 ${updated.version}` : "已保存")
      // Only when the history is already on screen: saving should not pop it open.
      if (historyOpen) void refreshHistory()
    } catch (failure) {
      const conflict = failure instanceof ApiError && failure.status === 409
      setNotice(conflict
        ? "这节课在别处已被修改（版本冲突）：先复制你的改动，再刷新重来。"
        : "保存失败，请确认本地后端正在运行。")
    } finally {
      setSaving(false)
    }
  }

  /**
   * What this revision changed about the one before it.
   *
   * Both documents are read on demand: the history list carries only how much
   * each revision holds, and a reader deciding which version to go back to is
   * asking what changed, not how much. Nothing is fetched until it is asked for.
   */
  async function toggleDiff(version: number) {
    if (!lesson) return
    if (diffs[version]) {
      setDiffs((current) => {
        // The row's own entry is the only thing removed: a second click closes it.
        const rest = { ...current }
        delete rest[version]
        return rest
      })
      return
    }
    setDiffs((current) => ({ ...current, [version]: "loading" }))
    try {
      const previous = version > 1 ? await getLesson(lesson.id, version - 1) : null
      const revision = await getLesson(lesson.id, version)
      const rows = compareLessonSections(previous?.sections ?? [], revision.sections)
      setDiffs((current) => ({ ...current, [version]: rows }))
    } catch {
      setDiffs((current) => ({ ...current, [version]: "error" }))
    }
  }

  /**
   * Is anything on the page different from what was loaded?
   *
   * Written inline so the hook's dependencies are the state it actually reads;
   * a named helper would have to be listed as a dependency instead.
   */
  const dirty = useMemo(() => {
    if (!lesson) return false
    const practiceMoved = lesson.sections.some((section) => {
      const draft = practiceDrafts[section.id]
      if (!draft) return false
      const original = practiceDraftFromSection(section)
      return draft.question !== original.question
        || draft.optionsText !== original.optionsText
        || draft.correctAnswer !== original.correctAnswer
        || draft.explanation !== original.explanation
    })
    return practiceMoved
      || lesson.sections.some((section) =>
        drafts[section.id] !== undefined && drafts[section.id] !== sectionEditorText(section))
      || draftTitle.trim() !== lesson.title
      || draftStatus !== lesson.status
      || draftSubject !== (lesson.subject === "all" ? "" : lesson.subject)
  }, [lesson, drafts, practiceDrafts, draftTitle, draftStatus, draftSubject])

  /**
   * Warn before a reload or a closed tab throws the edits away.
   *
   * Only the browser's own exit, not in-app navigation: this shell has no route
   * blocker, and a homemade dialog covering every link would be worse than the
   * problem. The 取消 button is where a reader abandons edits deliberately.
   */
  useEffect(() => {
    if (!editing || !dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Chrome needs returnValue set; the string itself is not shown.
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [editing, dirty])

  useEffect(() => {
    let active = true
    async function loadLesson() {
      setLoading(true)
      setError("")
      try {
        const value = await getLesson(id)
        if (active) {
          setLesson(value)
          setCurrentVersion(value.version ?? 0)
          // 新建课程 lands here with ?edit=1: the page opens ready to write in.
          // Seeded here rather than in an effect of its own -- the lint rule is
          // right that syncing state from an effect cascades renders.
          if (wantsEditing) {
            const seed = editorSeed(value)
            setDrafts(seed.drafts)
            setPracticeDrafts(seed.practiceDrafts)
            setDraftTitle(seed.title)
            setDraftStatus(seed.status)
            setDraftSubject(seed.subject)
            setEditing(true)
          }
        }
      } catch (reason) {
        if (active) setError(failureMessage(reason, "无法读取课程"))
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadLesson()
    return () => {
      active = false
    }
  }, [id, requestVersion, wantsEditing])

  const sections = useMemo(() => (lesson ? sortSections(lesson.sections) : []), [lesson])
  const objectives = useMemo(() => (lesson ? objectivesForLesson(lesson) : []), [lesson])
  const hasAnyContent = useMemo(() => sections.some(sectionHasContent), [sections])

  if (loading) {
    return <section aria-busy="true" className="grid gap-4"><p className="text-sm text-muted-foreground">正在打开课程…</p></section>
  }

  if (error || !lesson) {
    return (
      <section className="grid gap-4">
        <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")} to="/lessons"><ArrowLeft data-icon="inline-start" />返回课程</Link>
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>{error || "找不到这门课程。"}</span>
          <Button variant="outline" size="sm" onClick={() => setRequestVersion((value) => value + 1)}><RotateCcw data-icon="inline-start" />重试</Button>
        </div>
      </section>
    )
  }

  return (
    <section className="grid gap-6">
      <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")} to="/lessons"><ArrowLeft data-icon="inline-start" />返回课程</Link>
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <BookOpenCheck aria-hidden="true" className="size-5 text-primary" />
          {editing ? (
            <>
              <Select
                ariaLabel="课程状态"
                value={draftStatus}
                onValueChange={setDraftStatus}
                options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
              />
              <Select
                ariaLabel="所属学科"
                value={draftSubject}
                onValueChange={setDraftSubject}
                options={[
                  { value: "", label: "综合" },
                  ...SUBJECTS.map((subject) => ({ value: subject.id, label: subject.name })),
                ]}
              />
            </>
          ) : (
            <>
              <Badge variant={lesson.status === "published" ? "default" : "secondary"}>{statusLabel(lesson.status)}</Badge>
              <span className="text-sm text-muted-foreground">{subjectName(lesson.subject)}</span>
            </>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Not while editing: the drafts are not saved yet, so the file would
                be the previous version -- a reader who exported mid-edit would
                have a document that disagrees with the screen in front of them. */}
            {editing ? null : (
              <Button size="sm" variant="ghost" onClick={() => downloadMarkdown()}>
                <Download data-icon="inline-start" />导出 Markdown
              </Button>
            )}
            {lesson.version ? (
              <Button size="sm" variant="ghost" onClick={() => void openHistory()}>
                <History data-icon="inline-start" />版本历史
              </Button>
            ) : null}
            {editing ? (
              <>
                {dirty ? <span className="text-xs text-muted-foreground">有未保存的改动</span> : null}
                <Button size="sm" disabled={saving} onClick={() => void saveEdits()}>{saving ? "保存中…" : "保存"}</Button>
                <Button size="sm" variant="outline" disabled={saving} onClick={cancelEditing}>
                  {dirty ? "放弃改动" : "取消"}
                </Button>
              </>
            ) : previewVersion === null ? (
              <Button size="sm" variant="outline" onClick={startEditing}>
                <Pencil data-icon="inline-start" />编辑内容
              </Button>
            ) : null}
          </div>
        </div>
        {notice ? <p role="status" aria-live="polite" className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-primary">{notice}</p> : null}
        {previewVersion !== null ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <span>正在查看第 {previewVersion} 版（只读）</span>
            <Button size="xs" variant="outline" onClick={() => void leavePreview()}>回到当前版本</Button>
            <Button size="xs" variant="outline" disabled={saving} onClick={() => void restoreVersion(previewVersion)}>
              恢复这一版
            </Button>
          </div>
        ) : null}
        {editing ? (
          <label className="grid gap-1 text-sm font-medium">
            课程标题
            <Input
              aria-label="课程标题"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
            />
          </label>
        ) : (
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{lesson.title}</h1>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><FileText aria-hidden="true" className="size-4" />来源：{sourceLabel(lesson)}</span>
          {lesson.estimated_minutes ? <span className="inline-flex items-center gap-1.5"><Clock3 aria-hidden="true" className="size-4" />预计 {lesson.estimated_minutes} 分钟</span> : null}
          {lesson.version ? <span>版本 {lesson.version}</span> : null}
        </div>
      </header>

      {/* The immutable history, one line per version. 恢复 is a deliberate click:
          it writes the old document as a new version rather than overwriting. */}
      {historyOpen ? (
        <Card>
          <CardHeader className="gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">版本历史</CardTitle>
              <Button size="xs" variant="ghost" onClick={() => setHistoryOpen(false)}>收起</Button>
            </div>
            <p className="text-xs text-muted-foreground">文档版本不可变：恢复旧版会写成新的一版，旧版永远留着。</p>
          </CardHeader>
          <CardContent className="grid gap-2">
            {history === null ? (
              <p className="text-sm text-muted-foreground">正在读取…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有版本记录。</p>
            ) : history.map((entry) => (
              <div key={entry.version} className="grid gap-2 rounded-lg bg-muted/45 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <strong>第 {entry.version} 版</strong>
                  {entry.version === currentVersion ? <Badge variant="secondary">当前</Badge> : null}
                  <span className="text-xs text-muted-foreground">
                    {formatMoment(entry.created_at)} · {entry.sections_filled} 节有内容
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button size="xs" variant="outline" onClick={() => void viewVersion(entry.version)}>查看</Button>
                    {entry.version > 1 ? (
                      <Button size="xs" variant="outline" onClick={() => void toggleDiff(entry.version)}>
                        {diffs[entry.version] ? "收起对比" : "对比上一版"}
                      </Button>
                    ) : null}
                    {entry.version !== currentVersion ? (
                      <Button size="xs" variant="outline" disabled={saving} onClick={() => void restoreVersion(entry.version)}>
                        恢复这一版
                      </Button>
                    ) : null}
                  </div>
                </div>
                {diffs[entry.version] === "loading" ? (
                  <p className="text-xs text-muted-foreground">正在对比…</p>
                ) : diffs[entry.version] === "error" ? (
                  <p role="alert" className="text-xs text-destructive">对比失败，请确认本地后端正在运行。</p>
                ) : Array.isArray(diffs[entry.version]) ? (
                  <ul aria-label={`第 ${entry.version} 版的变化`} className="grid gap-1 border-l-2 border-primary/25 pl-3 text-xs">
                    {changedSections(diffs[entry.version] as LessonSectionDiff[]).length === 0 ? (
                      <li className="text-muted-foreground">与上一版相同。</li>
                    ) : changedSections(diffs[entry.version] as LessonSectionDiff[]).map((change) => (
                      <li key={change.type} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{change.title}</span>
                        <span className="text-muted-foreground">{describeChange(change)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {objectives.length ? (
        <Card className="border-primary/25 bg-primary/5">
          <CardHeader className="gap-1.5"><CardTitle className="text-base">这次只需要带走</CardTitle></CardHeader>
          <CardContent><ul className="grid gap-2 text-sm leading-6">{objectives.map((objective, index) => <li key={`${objective}-${index}`} className="flex gap-2"><CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />{objective}</li>)}</ul></CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3" aria-label="课程环节">
        {sections.length > 0 && !hasAnyContent && !editing ? (
          <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
            这门课程还是一份空草稿：下面是固定十段的骨架，内容还没有写进来。按「编辑内容」就能开始填。
          </p>
        ) : null}
        {sections.length > 0 ? sections.map((section) => (
          editing && practiceDrafts[section.id] ? (
            <PracticeSectionEditor
              key={section.id}
              section={section}
              draft={practiceDrafts[section.id]}
              onChange={(draft) => setPracticeDrafts((current) => ({ ...current, [section.id]: draft }))}
            />
          ) : (
            <SectionView
              key={section.id}
              lessonID={lesson.id}
              section={section}
              editing={editing}
              draft={drafts[section.id] ?? ""}
              onDraftChange={(value) => setDrafts((current) => ({ ...current, [section.id]: value }))}
            />
          )
        )) : (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">这门课程还没有可预习的环节。</CardContent></Card>
        )}
      </div>
    </section>
  )
}
