import { useEffect, useState } from "react"

import { getDashboard } from "@/api/dashboard"
import { listMistakePage } from "@/api/mistakes"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** The three numbers 第 4 阶段 waits for, as ROADMAP writes them. */
const GATE = {
  correctedMistakes: 20,
  attempts: 30,
  knowledge: 30,
} as const

interface GateProgress {
  corrected: number
  attempts: number
  knowledge: number
}

/**
 * Why the Task / System Idea feature is not in the app yet, in numbers.
 *
 * ROADMAP 第 4 阶段 gates those two objects behind "the earlier objects must have
 * produced enough real records" -- and a gate nobody can compute is a mood. This reads
 * the counts that already exist and says where they stand, so "can we start?" is
 * answered by data rather than by how the day feels.
 *
 * It renders nothing on failure: the numbers are context, and the settings page it
 * lives on must keep working when the database cannot be read.
 */
export function PhaseGateNote() {
  const [progress, setProgress] = useState<GateProgress | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([
      getDashboard(),
      listMistakePage({ corrected: "yes", limit: 1 }),
    ])
      .then(([dashboard, corrected]) => {
        if (!active) return
        setProgress({
          corrected: corrected.count,
          attempts: dashboard.attempt_count,
          knowledge: dashboard.knowledge_count,
        })
      })
      .catch(() => {
        // No numbers, no card: nothing here is load-bearing.
      })
    return () => {
      active = false
    }
  }, [])

  if (!progress) return null

  const rows = [
    { key: "corrected", label: "已订正的错题", value: progress.corrected, target: GATE.correctedMistakes },
    { key: "attempts", label: "复习作答次数", value: progress.attempts, target: GATE.attempts },
    { key: "knowledge", label: "知识点", value: progress.knowledge, target: GATE.knowledge },
  ]
  const ready = rows.every((row) => row.value >= row.target)

  return (
    <Card data-phase-gate="true">
      <CardHeader className="gap-1.5">
        <CardTitle className="text-base">任务与系统想法：还没到能开工的时候</CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          这两个对象是元系统：前面的错题、课程与复习还没攒出足够的真实记录时，做出来只会变成
          「用整理工具回避学习」。门槛写在 <code className="text-xs">ROADMAP.md</code> 的第 4 阶段，这里是它现在的进度。
        </p>
      </CardHeader>
      <CardContent className="grid gap-2">
        <ul className="grid gap-1.5">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2 text-sm">
              <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full bg-primary"
                  style={{ width: `${Math.min(100, Math.round((row.value / row.target) * 100))}%` }}
                />
              </span>
              <span className="text-muted-foreground">{row.label}</span>
              <span className="ml-auto tabular-nums">
                {row.value} / {row.target}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {ready
            ? "三个数字都到了：可以开始做「任务」了（先做它，系统想法再等一轮）。"
            : "还没到之前，这两处入口都不会出现——也不做「敬请期待」那种占位。"}
        </p>
      </CardContent>
    </Card>
  )
}