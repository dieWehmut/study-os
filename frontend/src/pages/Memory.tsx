import { useEffect, useState } from "react"
import { Waves } from "lucide-react"

import { getDashboard } from "@/api/dashboard"
import type { DashboardData } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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

  useEffect(() => {
    let active = true
    getDashboard()
      .then((value) => {
        if (active) setDashboard(value)
      })
      .catch(() => {
        // 统计加载失败不阻塞复习。
      })
    return () => {
      active = false
    }
  }, [])

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
      <ReviewSession recovery={recovery} />
    </section>
  )
}
