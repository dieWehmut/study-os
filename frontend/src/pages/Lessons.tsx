import { useEffect, useState } from "react"
import { ArrowRight, BookOpenCheck, Clock3, FileText, RotateCcw } from "lucide-react"
import { Link } from "react-router-dom"

import { listLessons, type Lesson } from "@/api/lessons"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SubjectChips } from "@/features/subjects/SubjectChips"
import { subjectName } from "@/lib/subjects"
import { cn } from "@/lib/utils"
import { useSubjectStore } from "@/store/useSubjectStore"

const statusLabels: Record<string, string> = {
  draft: "草稿",
  reviewed: "已审核",
  published: "已发布",
  archived: "已归档",
}

function statusLabel(status: string): string {
  return statusLabels[status] ?? status
}

function sourceLabel(lesson: Lesson): string {
  if (lesson.source?.title) return lesson.source.title
  if (lesson.source_id) return lesson.source_id
  if (lesson.source_type) return lesson.source_type
  return "未关联资料"
}

export default function Lessons() {
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)
  const [items, setItems] = useState<Lesson[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    let active = true
    async function loadLessons() {
      setLoading(true)
      setError("")
      try {
        const result = await listLessons({
          subject: subject === "all" ? undefined : subject,
          limit: 100,
          offset: 0,
        })
        if (!active) return
        setItems(result.items)
        setCount(result.count)
      } catch {
        if (active) setError("课程暂时无法读取，请确认本地后端正在运行。")
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadLessons()
    return () => {
      active = false
    }
  }, [subject, requestVersion])

  function retry() {
    setRequestVersion((value) => value + 1)
  }

  return (
    <section className="grid gap-6">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpenCheck aria-hidden="true" className="size-5 text-primary" />
            <h1 className="font-heading text-3xl font-semibold tracking-tight">课程预习</h1>
          </div>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {loading ? "正在读取…" : `${count} 门课程`}
          </span>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          先看目标、结构和一题小练习，再决定今天要深入哪一节。
        </p>
        <SubjectChips subject={subject} onSelect={setSubject} />
      </header>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={retry}>
            <RotateCcw data-icon="inline-start" />重试
          </Button>
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <Card>
          <CardContent className="grid justify-items-center gap-3 py-14 text-center">
            <BookOpenCheck aria-hidden="true" className="size-8 text-muted-foreground" />
            <h2 className="font-heading text-xl font-semibold">还没有课程</h2>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              把一段资料先整合成结构，之后就能在这里按固定顺序预习。
            </p>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} to="/integrate">
              去整合资料<ArrowRight data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {items.length > 0 ? (
        <div className="grid gap-3" aria-label="课程列表">
          {items.map((lesson) => (
            <Card key={lesson.id} size="sm" className="transition-colors hover:ring-primary/30">
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 grid gap-1.5">
                  <CardTitle className="truncate text-base">
                    <Link className="rounded-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={`/lessons/${encodeURIComponent(lesson.id)}`}>
                      {lesson.title}
                    </Link>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{subjectName(lesson.subject)}</p>
                </div>
                <Badge variant={lesson.status === "published" ? "default" : "secondary"}>{statusLabel(lesson.status)}</Badge>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><FileText aria-hidden="true" className="size-3.5" />来源：{sourceLabel(lesson)}</span>
                <span>{lesson.sections_count ?? lesson.sections.length} 个环节</span>
                {lesson.estimated_minutes ? <span className="inline-flex items-center gap-1.5"><Clock3 aria-hidden="true" className="size-3.5" />约 {lesson.estimated_minutes} 分钟</span> : null}
                <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto text-primary")} to={`/lessons/${encodeURIComponent(lesson.id)}`}>
                  查看预习<ArrowRight data-icon="inline-end" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </section>
  )
}
