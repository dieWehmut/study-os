import { useEffect, useState } from "react"
import { ArrowRight, BrainCircuit, CalendarCheck2, CloudOff, Flame, LibraryBig, MessagesSquare, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"

import { getDashboard, seedDemo } from "@/api/dashboard"
import { dumpThought } from "@/api/chat"
import type { DashboardData } from "@/api/types"
import { buttonVariants, Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { itemTypeLabel, providerLabel } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { SubjectBadge } from "@/features/subjects/SubjectBadge"
import { SubjectPicker } from "@/features/subjects/SubjectPicker"
import { useSubjectStore } from "@/store/useSubjectStore"

const emptyDashboard: DashboardData = {
  knowledge_count: 0,
  prompt_count: 0,
  due_count: 0,
  attempt_count: 0,
  reviewed_today: 0,
  current_streak: 0,
  provider: "mock",
  offline: true,
  subjects_due: {},
  recent_items: [],
}

export default function Home() {
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState("")
  const [dumpText, setDumpText] = useState("")
  const [dumping, setDumping] = useState(false)
  const [dumpNotice, setDumpNotice] = useState("")

  const subjectFilter = subject === "all" ? undefined : subject

  async function refreshDashboard() {
    setLoading(true)
    setError("")
    try {
      setDashboard(await getDashboard(subjectFilter))
    } catch {
      setError("无法读取学习进度，请确认本地后端正在运行。")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    getDashboard(subject === "all" ? undefined : subject)
      .then((value) => {
        if (active) setDashboard(value)
      })
      .catch(() => {
        if (active) setError("无法读取学习进度，请确认本地后端正在运行。")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [subject])

  async function loadDemo() {
    setSeeding(true)
    setError("")
    try {
      await seedDemo()
      await refreshDashboard()
    } catch {
      setError("英语示例没有载入，请重试。")
    } finally {
      setSeeding(false)
    }
  }

  async function saveDump() {
    const text = dumpText.trim()
    if (!text || dumping) return
    setDumping(true)
    setDumpNotice("")
    try {
      await dumpThought(text)
      setDumpText("")
      setDumpNotice("已暂存到知识库，稍后可以整理。")
    } catch {
      setDumpNotice("暂存失败，请重试。")
    } finally {
      setDumping(false)
    }
  }

  return (
    <section className="grid gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">只检测值得记忆的内容；每次作答都会留下他评、反馈和下一次复习安排。</p>
      </div>

      <Card>
        <CardHeader className="gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>选择学科</CardTitle>
            <button
              type="button"
              aria-pressed={subject === "all"}
              onClick={() => setSubject("all")}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                subject === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              全部
            </button>
          </div>
          <p className="text-sm text-muted-foreground">不同学科有各自的记忆题型与整理方式，选一个开始。</p>
        </CardHeader>
        <CardContent>
          <SubjectPicker subject={subject} onSelect={setSubject} dueCounts={dashboard.subjects_due} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>先把念头扔进来</CardTitle>
          <p className="text-sm text-muted-foreground">不用分类、不用写完整，半句话也可以，先存下再说。</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <textarea
            aria-label="脑暴收集箱"
            value={dumpText}
            onChange={(event) => setDumpText(event.target.value)}
            placeholder="例如：等下查一下动能定理的适用条件…"
            className="min-h-20 resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-3">
            <Button disabled={!dumpText.trim() || dumping} onClick={() => void saveDump()}>
              {dumping ? "暂存中…" : "暂存"}
            </Button>
            {dumpNotice ? <p aria-live="polite" className="text-sm text-muted-foreground">{dumpNotice}</p> : null}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void refreshDashboard()}>重试</Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="relative overflow-hidden lg:col-span-2">
          <CardHeader className="gap-3">
            <CardTitle className="text-sm font-normal text-muted-foreground">今天要巩固</CardTitle>
            <p className="font-heading text-5xl font-semibold tracking-tight sm:text-6xl">
              {loading ? "—" : `${dashboard.due_count} 个待复习`}
            </p>
            <p className="text-sm text-muted-foreground">
              今日已完成 {dashboard.reviewed_today} 次检测 · 连续学习 {dashboard.current_streak} 天
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Link className={buttonVariants({ size: "lg" })} to="/memory">
              开始复习<ArrowRight data-icon="inline-end" />
            </Link>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {dashboard.offline ? <CloudOff aria-hidden="true" className="size-4 text-primary" /> : <Sparkles aria-hidden="true" className="size-4 text-primary" />}
              {providerLabel(dashboard.provider)} · {dashboard.offline ? "离线可用" : "在线"}
            </span>
          </CardContent>
        </Card>

        <div className="grid content-stretch gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm font-normal text-muted-foreground">知识点</CardTitle>
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><LibraryBig aria-hidden="true" className="size-4" /></span>
            </CardHeader>
            <CardContent><p className="text-3xl font-semibold">{loading ? "—" : `${dashboard.knowledge_count} 个知识点`}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm font-normal text-muted-foreground">今日检测</CardTitle>
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><CalendarCheck2 aria-hidden="true" className="size-4" /></span>
            </CardHeader>
            <CardContent><p className="text-3xl font-semibold">{loading ? "—" : `${dashboard.reviewed_today} 次`}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm font-normal text-muted-foreground">连续学习</CardTitle>
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Flame aria-hidden="true" className="size-4" /></span>
            </CardHeader>
            <CardContent><p className="text-3xl font-semibold">{loading ? "—" : `${dashboard.current_streak} 天`}</p></CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { to: "/knowledge", label: "知识库", description: "浏览与整理知识点", icon: LibraryBig },
          { to: "/memory", label: "记忆", description: "按计划完成复习", icon: BrainCircuit },
          { to: "/chat", label: "答疑", description: "随时问 AI，异步回答", icon: MessagesSquare },
        ].map(({ to, label, description, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-auto flex-col items-start gap-1.5 p-4",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Icon aria-hidden="true" className="size-4 text-primary" />
              {label}
            </span>
            <span className="text-xs font-normal text-muted-foreground">{description}</span>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>最近加入</CardTitle>
          <p className="text-sm text-muted-foreground">最新整理的知识点与念头</p>
        </CardHeader>
        <CardContent className="grid gap-2">
          {!dashboard.recent_items || dashboard.recent_items.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              还没有知识点。先去导入资料，或在上方暂存一个念头。
            </p>
          ) : (
            dashboard.recent_items.map((item) => (
              <Link
                key={item.id}
                to="/knowledge"
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <span className="truncate text-sm font-medium">{item.term}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {item.subject ? <SubjectBadge subject={item.subject} /> : null}
                  <span className="text-xs text-muted-foreground">{itemTypeLabel(item.item_type)}</span>
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {!loading && dashboard.knowledge_count === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="gap-2">
            <CardTitle>先体验一轮真实记忆闭环</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="text-sm leading-6 text-muted-foreground">加载一个英语词义示例，系统会生成英译中、中译英和语境填空三种检测。</p>
            <Button disabled={seeding} onClick={() => void loadDemo()}>{seeding ? "正在载入…" : "载入英语示例"}</Button>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
