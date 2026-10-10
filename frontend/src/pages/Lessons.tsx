import { useCallback, useEffect, useState } from "react"
import { ArrowRight, BookOpenCheck, Clock3, FileText, Plus, RotateCcw } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import { createLesson, listLessons, type Lesson, type LessonStatus } from "@/api/lessons"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { SubjectChips } from "@/features/subjects/SubjectChips"
import { subjectName, SUBJECTS } from "@/lib/subjects"
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
  const [loadingMore, setLoadingMore] = useState(false)
  // The list is one page of the newest courses, so an older one is not hard to
  // find here -- it is not in the list at all.
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState("")
  // 草稿 is a real state now that a course can be created and filed by hand: with
  // a growing library, "only the drafts" is the question worth asking.
  const [status, setStatus] = useState<LessonStatus | "">("")
  // A course written by hand rather than handed over by 整合. The ten-section
  // template is created empty and filled in on its own page.
  const [drafting, setDrafting] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [newSubject, setNewSubject] = useState(subject === "all" ? "" : subject)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState("")
  const navigate = useNavigate()

  async function createBlankLesson() {
    const title = newTitle.trim()
    if (!title || creating) {
      if (!title) setCreateError("给这门课起个标题。")
      return
    }
    setCreating(true)
    setCreateError("")
    try {
      const lesson = await createLesson({ title, ...(newSubject ? { subject: newSubject } : {}) })
      // Straight into filling it: a blank ten-section skeleton on a reading page
      // is a page with nothing to do on it.
      navigate(`/lessons/${encodeURIComponent(lesson.id)}?edit=1`)
    } catch {
      setCreateError("新建课程失败，请确认本地后端正在运行。")
    } finally {
      setCreating(false)
    }
  }

  /** The filters in hand, as the request they become -- one page at `offset`. */
  const listOptions = useCallback((offset: number): Parameters<typeof listLessons>[0] => ({
    subject: subject === "all" ? undefined : subject,
    query: query || undefined,
    status: status || undefined,
    limit: 100,
    offset,
  }), [subject, query, status])

  /**
   * The next page, appended.
   *
   * One request of 100, and the page says how many there are: without this the
   * course library is browsable only as far as its first page.
   */
  async function loadMore() {
    if (loadingMore) return
    setLoadingMore(true)
    setError("")
    try {
      const result = await listLessons(listOptions(items.length))
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...result.items.filter((item) => !seen.has(item.id))]
      })
      setCount(result.count)
    } catch {
      setError("读取更多课程失败，请重试。")
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    let active = true
    async function loadLessons() {
      setLoading(true)
      setError("")
      try {
        const result = await listLessons(listOptions(0))
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
  }, [listOptions, requestVersion])

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
        {/* 100 courses is the page; past it the rest are unreachable. */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="搜索课程标题"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              setQuery(draft.trim())
            }}
            placeholder="搜标题里的词"
            className="h-9 max-w-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="搜索课程"
            disabled={!draft.trim() || draft.trim() === query}
            onClick={() => setQuery(draft.trim())}
          >
            搜索
          </Button>
          {query ? (
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              只显示标题含「{query}」的课程
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => {
                  setDraft("")
                  setQuery("")
                }}
              >
                清除
              </button>
            </span>
          ) : null}
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">只看</span>
            <Select
              ariaLabel="按状态筛选课程"
              value={status}
              onValueChange={(value) => setStatus(value as LessonStatus | "")}
              // The empty value means "every status", so the control says that
              // rather than the default 请选择.
              placeholder="全部状态"
              options={[
                { value: "", label: "全部状态" },
                ...Object.entries(statusLabels).map(([value, label]) => ({ value, label })),
              ]}
            />
          </span>
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            aria-expanded={drafting}
            onClick={() => {
              setDrafting((open) => !open)
              setCreateError("")
            }}
          >
            <Plus data-icon="inline-start" />新建课程
          </Button>
        </div>
        {drafting ? (
          <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="新课程标题"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  void createBlankLesson()
                }}
                placeholder="这门课叫什么？"
                className="h-9 max-w-xs"
              />
              <Select
                ariaLabel="新课程学科"
                value={newSubject}
                onValueChange={setNewSubject}
                options={[
                  { value: "", label: "综合" },
                  ...SUBJECTS.map((subject) => ({ value: subject.id, label: subject.name })),
                ]}
              />
              <Button type="button" size="sm" disabled={creating} onClick={() => void createBlankLesson()}>
                {creating ? "正在新建…" : "创建"}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={creating} onClick={() => setDrafting(false)}>
                取消
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">会生成固定十节的空骨架，创建后直接进入编辑。</p>
            {createError ? <p role="alert" className="text-sm text-destructive">{createError}</p> : null}
          </div>
        ) : null}
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
        query || status ? (
          <Card>
            <CardContent className="py-14 text-center text-sm text-muted-foreground">
              {/* The filter emptied the page, not the library: saying 还没有课程
                  here would be the same lie the search-only version told. */}
              {query
                ? `没有标题含「${query}」${status ? `、且状态为「${statusLabel(status)}」` : ""}的课程。`
                : `没有状态为「${statusLabel(status)}」的课程。`}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="grid justify-items-center gap-3 py-14 text-center">
              <BookOpenCheck aria-hidden="true" className="size-8 text-muted-foreground" />
              <h2 className="font-heading text-xl font-semibold">还没有课程</h2>
              <p className="max-w-md text-sm leading-6 text-muted-foreground">
                把一段资料先整合成结构，或者自己起一个标题从十节骨架写起。
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link className={buttonVariants({ variant: "outline", size: "sm" })} to="/integrate">
                  去整合资料<ArrowRight data-icon="inline-end" />
                </Link>
                <Button variant="outline" size="sm" onClick={() => setDrafting(true)}>
                  <Plus data-icon="inline-start" />新建课程
                </Button>
              </div>
            </CardContent>
          </Card>
        )
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

      {/* Said as well as offered: the count is what tells you whether there is
          anything left to look at, and "加载更多" alone does not. */}
      {items.length > 0 && count > items.length ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "正在读取…" : `加载更多（还有 ${count - items.length} 门）`}
        </Button>
      ) : null}
    </section>
  )
}
