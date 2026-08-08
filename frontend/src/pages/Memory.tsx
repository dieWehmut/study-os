import { useEffect, useState } from "react"
import { Waves } from "lucide-react"

import { getDashboard } from "@/api/dashboard"
import type { DashboardData } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ReviewForecast } from "@/features/memory/ReviewForecast"
import { ReviewSession } from "@/features/memory/ReviewSession"
import { SubjectChips } from "@/features/subjects/SubjectChips"
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
}

export default function Memory() {
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)
  const [recovery, setRecovery] = useState(false)
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  // Bumped after each answered card so the counters below follow the queue.
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let active = true
    getDashboard(subject === "all" ? undefined : subject)
      .then((value) => {
        if (active) setDashboard(value)
      })
      .catch(() => {
        // 统计加载失败不阻塞复习。
      })
    return () => {
      active = false
    }
  }, [subject, refreshToken])

  // What today asked for: everything already answered plus everything still
  // waiting. Due alone shrinks as you work and never says how far you have come.
  const queueTotal = dashboard.reviewed_today + dashboard.due_count
  const queuePercent = queueTotal > 0 ? Math.round((dashboard.reviewed_today / queueTotal) * 100) : 0

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Waves aria-hidden="true" className="size-4 text-primary" />
            <h1 className="font-heading text-2xl font-semibold tracking-tight">记忆检测</h1>
          </div>
          <p className="text-sm text-muted-foreground">只做高频、快捷、无需逻辑思考的检测。</p>
        </div>
        <Button
          type="button"
          variant={recovery ? "default" : "outline"}
          aria-pressed={recovery}
          onClick={() => setRecovery((value) => !value)}
        >
          {recovery ? "恢复模式已开启" : "恢复模式"}
        </Button>
      </div>
      {recovery ? (
        <Badge variant="secondary" className="w-fit">脑雾时只推送低阻力任务（看词回忆 / 四选一猜词）</Badge>
      ) : null}
      <SubjectChips subject={subject} onSelect={setSubject} />
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "待复习", value: dashboard.due_count },
          { label: "今日已复习", value: dashboard.reviewed_today },
          { label: "知识点", value: dashboard.knowledge_count },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="grid gap-1 py-4">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-2xl font-semibold">{value}</span>
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Two counts make you hold both numbers and divide to answer "am I
          nearly done?" -- the question that decides whether you keep going.
          Hidden when nothing was scheduled: a 0/0 bar sitting at full would
          read as "done" on a day that never had anything to do. */}
      {queueTotal > 0 ? (
        <Card>
          <CardContent className="py-4">
            <Progress value={queuePercent} aria-label="今日进度">
              <span className="text-sm font-medium">今日进度</span>
              <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                {dashboard.reviewed_today} / {queueTotal}
              </span>
            </Progress>
          </CardContent>
        </Card>
      ) : null}
      {/* Below today's progress and above the session: the forecast is context
          for the work, not the work. 待复习 is one number, and one number
          cannot show a pile-up -- FSRS spreads skipped days forward, invisibly,
          until the day they all land on. */}
      <ReviewForecast />
      <ReviewSession recovery={recovery} onProgress={() => setRefreshToken((value) => value + 1)} />
    </section>
  )
}
