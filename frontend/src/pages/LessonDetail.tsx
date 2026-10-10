import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, BookOpenCheck, CheckCircle2, CircleHelp, Clock3, FileText, Pencil, RotateCcw } from "lucide-react"
import { Link, useParams } from "react-router-dom"

import { getLesson, LESSON_SECTION_ORDER, updateLesson, type Lesson, type LessonSection } from "@/api/lessons"
import { ApiError } from "@/api/client"
import { Badge } from "@/components/ui/badge"
import LessonPractice from "@/components/lessons/LessonPractice"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  isEditableSection,
  sectionContentFromText,
  sectionContentKind,
  sectionEditorText,
  sectionHasContent,
  sectionItems,
  sectionText,
} from "@/lib/lesson-content"
import { subjectName } from "@/lib/subjects"
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

export default function LessonDetail() {
  const { id = "" } = useParams()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [requestVersion, setRequestVersion] = useState(0)
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")

  function startEditing() {
    if (!lesson) return
    setDrafts(Object.fromEntries(
      lesson.sections.map((section) => [section.id, sectionEditorText(section)]),
    ))
    setNotice("")
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setDrafts({})
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
      const sections = lesson.sections.map((section) => (
        drafts[section.id] !== undefined && isEditableSection(section)
          ? { ...section, content: sectionContentFromText(section, drafts[section.id]) }
          : section
      ))
      const updated = await updateLesson(lesson.id, {
        version: lesson.version ?? 1,
        document: { schema_version: lesson.document?.schema_version ?? 1, sections },
      })
      setLesson(updated)
      setEditing(false)
      setDrafts({})
      setNotice(updated.version ? `已保存 · 版本 ${updated.version}` : "已保存")
    } catch (failure) {
      const conflict = failure instanceof ApiError && failure.status === 409
      setNotice(conflict
        ? "这节课在别处已被修改（版本冲突）：先复制你的改动，再刷新重来。"
        : "保存失败，请确认本地后端正在运行。")
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    let active = true
    async function loadLesson() {
      setLoading(true)
      setError("")
      try {
        const value = await getLesson(id)
        if (active) setLesson(value)
      } catch {
        if (active) setError("课程暂时无法读取，请确认本地后端正在运行。")
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadLesson()
    return () => {
      active = false
    }
  }, [id, requestVersion])

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
          <Badge variant={lesson.status === "published" ? "default" : "secondary"}>{statusLabel(lesson.status)}</Badge>
          <span className="text-sm text-muted-foreground">{subjectName(lesson.subject)}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <Button size="sm" disabled={saving} onClick={() => void saveEdits()}>{saving ? "保存中…" : "保存"}</Button>
                <Button size="sm" variant="outline" disabled={saving} onClick={cancelEditing}>取消</Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={startEditing}>
                <Pencil data-icon="inline-start" />编辑内容
              </Button>
            )}
          </div>
        </div>
        {notice ? <p role="status" aria-live="polite" className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-primary">{notice}</p> : null}
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{lesson.title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><FileText aria-hidden="true" className="size-4" />来源：{sourceLabel(lesson)}</span>
          {lesson.estimated_minutes ? <span className="inline-flex items-center gap-1.5"><Clock3 aria-hidden="true" className="size-4" />预计 {lesson.estimated_minutes} 分钟</span> : null}
          {lesson.version ? <span>版本 {lesson.version}</span> : null}
        </div>
      </header>

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
          <SectionView
            key={section.id}
            lessonID={lesson.id}
            section={section}
            editing={editing}
            draft={drafts[section.id] ?? ""}
            onDraftChange={(value) => setDrafts((current) => ({ ...current, [section.id]: value }))}
          />
        )) : (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">这门课程还没有可预习的环节。</CardContent></Card>
        )}
      </div>
    </section>
  )
}
