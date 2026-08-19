import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, BookOpenCheck, CheckCircle2, CircleHelp, Clock3, FileText, RotateCcw } from "lucide-react"
import { Link, useParams } from "react-router-dom"

import { getLesson, LESSON_SECTION_ORDER, type Lesson, type LessonSection } from "@/api/lessons"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

function sectionContent(section: LessonSection): unknown {
  if (section.content !== undefined) return section.content
  if (section.body !== undefined) return section.body
  if (section.markdown !== undefined) return section.markdown
  if (section.summary !== undefined) return section.summary
  return ""
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join("\n")
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of ["text", "body", "markdown", "prompt", "question"]) {
      if (typeof record[key] === "string") return record[key] as string
    }
    return ""
  }
  return ""
}

function contentItems(section: LessonSection): string[] {
  if (section.items?.length) return section.items
  const value = section.content
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  if (value && typeof value === "object") {
    const items = (value as Record<string, unknown>).items
    if (Array.isArray(items)) return items.filter((item): item is string => typeof item === "string")
    const options = (value as Record<string, unknown>).options
    if (Array.isArray(options)) return options.filter((item): item is string => typeof item === "string")
  }
  return []
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

function SectionView({ section }: { section: LessonSection }) {
  const type = sectionType(section)
  const text = contentText(sectionContent(section))
  const items = contentItems(section)
  const isQuiz = type === "practice" || type === "quiz"
  return (
    <article data-section-kind={type} className="grid gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {isQuiz ? <CircleHelp aria-hidden="true" className="size-4 text-primary" /> : <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />}
        <h2 className="font-heading text-lg font-semibold">{section.title || sectionLabels[type] || type}</h2>
        {section.required ? <Badge variant="outline">必看</Badge> : null}
      </div>
      {text ? <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{text}</p> : null}
      {items.length > 0 ? (
        <ol className="grid gap-2 pl-5 text-sm leading-6 marker:text-muted-foreground">
          {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ol>
      ) : null}
      {!text && items.length === 0 ? <p className="text-sm text-muted-foreground">这一节还没有内容。</p> : null}
    </article>
  )
}

export default function LessonDetail() {
  const { id = "" } = useParams()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [requestVersion, setRequestVersion] = useState(0)

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
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{lesson.title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><FileText aria-hidden="true" className="size-4" />来源：{sourceLabel(lesson)}</span>
          {lesson.estimated_minutes ? <span className="inline-flex items-center gap-1.5"><Clock3 aria-hidden="true" className="size-4" />预计 {lesson.estimated_minutes} 分钟</span> : null}
          {lesson.version ? <span>版本 {lesson.version}</span> : null}
        </div>
      </header>

      {lesson.objectives?.length ? (
        <Card className="border-primary/25 bg-primary/5">
          <CardHeader className="gap-1.5"><CardTitle className="text-base">这次只需要带走</CardTitle></CardHeader>
          <CardContent><ul className="grid gap-2 text-sm leading-6">{lesson.objectives.map((objective, index) => <li key={`${objective}-${index}`} className="flex gap-2"><CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />{objective}</li>)}</ul></CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3" aria-label="课程环节">
        {sections.length > 0 ? sections.map((section) => <SectionView key={section.id} section={section} />) : (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">这门课程还没有可预习的环节。</CardContent></Card>
        )}
      </div>
    </section>
  )
}
