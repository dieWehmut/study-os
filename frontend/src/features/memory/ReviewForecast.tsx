import { useEffect, useState } from "react"

import { getReviewForecast, type ForecastDay } from "@/api/reviews"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useSubjectStore } from "@/store/useSubjectStore"

const HORIZON = 7

/**
 * Name a column without making the reader decode a date.
 *
 * Index, not date arithmetic: the backend already returns today first, on the
 * learner's own clock, and re-deriving "today" here would give two answers to
 * one question across a midnight or a timezone.
 */
function dayLabel(index: number, date: string): string {
  if (index === 0) return "今天"
  if (index === 1) return "明天"
  return `${Number(date.slice(8, 10))}日`
}

/**
 * What the coming week will ask of you.
 *
 * 待复习 is one number, and one number cannot show a pile-up. FSRS spreads work
 * forward, so skipping today is invisible until the day it lands on arrives --
 * and the day it lands on is the one people quit at.
 *
 * The panel is context, not the task. Everything about it stays quiet: it
 * renders nothing while loading, nothing on failure, and nothing when there is
 * no schedule to show, rather than pushing the review queue below the fold to
 * report on something optional.
 */
export function ReviewForecast() {
  const subject = useSubjectStore((state) => state.subject)
  const [days, setDays] = useState<ForecastDay[]>([])

  useEffect(() => {
    let active = true
    getReviewForecast(HORIZON, subject === "all" ? undefined : subject)
      .then((forecast) => {
        if (active) setDays(forecast.days ?? [])
      })
      .catch(() => {
        // Losing the forecast must not cost you the queue it sits above.
        if (active) setDays([])
      })
    return () => {
      active = false
    }
  }, [subject])

  // Scaled against the busiest day rather than a fixed ceiling: a fixed one
  // flattens the whole chart on a light week and clips it on a heavy one, and
  // the point of the panel is the shape.
  const peak = days.reduce((most, day) => Math.max(most, day.count), 0)

  if (days.length === 0) return null

  if (peak === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          {/* Seven flat bars read as a broken chart. Nothing due is good news
              and should say so, along with what to do with the room. */}
          <p className="text-sm text-muted-foreground">
            接下来这一周没有排期 —— 正好可以多收几条进知识库。
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="gap-1.5">
        <CardTitle className="text-base">接下来七天</CardTitle>
        <p className="text-sm text-muted-foreground">
          最多的一天 {peak} 张 —— 今天少做的，都会堆到那一天。
        </p>
      </CardHeader>
      <CardContent>
        <ul className="flex items-end gap-1.5">
          {days.map((day, index) => (
            <li key={day.date} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-xs tabular-nums text-muted-foreground">
                {day.count > 0 ? day.count : ""}
              </span>
              <div className="flex h-20 w-full items-end overflow-hidden rounded-sm bg-muted/60">
                <div
                  title={`${day.date}：${day.count} 张`}
                  className={
                    index === 0 ? "w-full rounded-sm bg-primary" : "w-full rounded-sm bg-primary/45"
                  }
                  style={{ height: `${Math.round((day.count / peak) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">{dayLabel(index, day.date)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
