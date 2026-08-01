import { useEffect, useState } from "react"
import { ArrowRight, CalendarCheck2, CloudOff, Flame, LibraryBig } from "lucide-react"
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
			setError("\u65e0\u6cd5\u8bfb\u53d6\u5b66\u4e60\u8fdb\u5ea6\uff0c\u8bf7\u786e\u8ba4\u672c\u5730\u540e\u7aef\u6b63\u5728\u8fd0\u884c\u3002")
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
				if (active) setError("\u65e0\u6cd5\u8bfb\u53d6\u5b66\u4e60\u8fdb\u5ea6\uff0c\u8bf7\u786e\u8ba4\u672c\u5730\u540e\u7aef\u6b63\u5728\u8fd0\u884c\u3002")
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
			setError("\u82f1\u8bed\u793a\u4f8b\u6ca1\u6709\u8f7d\u5165\uff0c\u8bf7\u91cd\u8bd5\u3002")
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
        <Link className={buttonVariants({ size: "lg" })} to="/memory">
          开始复习 <ArrowRight data-icon="inline-end" />
        </Link>
      </div>

		{error ? (
			<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">
				<span>{error}</span>
				<Button variant="outline" size="sm" disabled={loading} onClick={() => void refreshDashboard()}>重试</Button>
			</div>
		) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-normal text-muted-foreground">待复习</CardTitle>
            <CalendarCheck2 aria-hidden="true" className="text-primary" />
          </CardHeader>
          <CardContent><p className="text-3xl font-semibold">{loading ? "…" : `${dashboard.due_count} 个待复习`}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-normal text-muted-foreground">知识点</CardTitle>
            <LibraryBig aria-hidden="true" className="text-primary" />
          </CardHeader>
          <CardContent><p className="text-3xl font-semibold">{loading ? "…" : `${dashboard.knowledge_count} 个知识点`}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-normal text-muted-foreground">连续学习</CardTitle>
            <Flame aria-hidden="true" className="text-primary" />
          </CardHeader>
          <CardContent><p className="text-3xl font-semibold">{loading ? "…" : `${dashboard.current_streak} 天`}</p></CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card/70 px-4 py-3 text-sm">
        {dashboard.offline ? <CloudOff aria-hidden="true" className="text-primary" /> : null}
        <span>{dashboard.provider === "mock" ? "Mock AI" : dashboard.provider} · {dashboard.offline ? "离线可用" : "在线"}</span>
        <span className="text-muted-foreground">今日已完成 {dashboard.reviewed_today} 次检测</span>
      </div>

      {!loading && dashboard.knowledge_count === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>先体验一轮真实记忆闭环</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="text-sm leading-6 text-muted-foreground">载入一个英语词义示例，系统会生成英译中、中译英和语境填空三种检测。</p>
            <Button disabled={seeding} onClick={() => void loadDemo()}>{seeding ? "正在载入…" : "载入英语示例"}</Button>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
