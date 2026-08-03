import { useEffect, useState } from "react"
import { ArrowRight, CalendarCheck2, CloudOff, Flame, LibraryBig, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"

import { getDashboard, seedDemo } from "@/api/dashboard"
import type { DashboardData } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { buttonVariants, Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const emptyDashboard: DashboardData = {
  knowledge_count: 0,
  prompt_count: 0,
  due_count: 0,
  attempt_count: 0,
  reviewed_today: 0,
  current_streak: 0,
  provider: "mock",
  offline: true,
}

export default function Home() {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState("")

  async function refreshDashboard() {
    setLoading(true)
    setError("")
    try {
      setDashboard(await getDashboard())
    } catch {
      setError("无法读取学习进度，请确认本地后端正在运行。")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    getDashboard()
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
  }, [])

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

  return (
    <section className="grid gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <Badge variant="secondary" className="w-fit">今日计划</Badge>
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">把新知识变成可记住的进度</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">只检测值得记忆的内容；每次作答都会留下他评、反馈和下一次复习安排。</p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void refreshDashboard()}>重试</Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="relative overflow-hidden lg:col-span-2">
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-primary/8 to-transparent" />
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
              {dashboard.provider === "mock" ? "Mock AI" : dashboard.provider} · {dashboard.offline ? "离线可用" : "在线"}
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
