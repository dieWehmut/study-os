import { useState } from "react"
import { Check, CircleAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { checkCoverage } from "@/lib/scoring-points"

export interface ScoringBoardValue {
  points: string[]
  answer: string
}

interface ScoringBoardProps {
  initialValue?: ScoringBoardValue
  onChange?: (value: ScoringBoardValue) => void
}

function pointLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
}

/**
 * An answer, laid against the 得分点 it was meant to hit.
 *
 * 对着得分点拆答案：踩到几个点，缺的是哪一类 is the advice this carries out.
 * Two boxes because the comparison is the whole exercise: with only your own
 * answer on screen you re-read it and it reads complete, which is exactly the
 * failure the advice is about.
 */
export function ScoringBoard({ initialValue, onChange }: ScoringBoardProps = {}) {
  const [listed, setListed] = useState(() => initialValue?.points.join("\n") ?? "")
  const [answer, setAnswer] = useState(() => initialValue?.answer ?? "")

  // A blank line between two points is spacing. Counting it would put 踩到 2/3
  // where 2/2 is the truth, and the denominator is the number this board is
  // for.
  const points = pointLines(listed).map((text) => ({ text }))

  const checked = checkCoverage(points, answer)
  const written = answer.trim() !== ""
  const missing = checked.points.filter((point) => point.verdict === "missing")

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <Textarea
        aria-label="标准答案的得分点"
        value={listed}
        onChange={(event) => {
          const next = event.target.value
          setListed(next)
          onChange?.({ points: pointLines(next), answer })
        }}
        placeholder={"一行一个点，比如\n借景抒情\n对比/衬托\n思乡之情"}
        rows={4}
      />
      <Textarea
        aria-label="你写的答案"
        value={answer}
        onChange={(event) => {
          const next = event.target.value
          setAnswer(next)
          onChange?.({ points: pointLines(listed), answer: next })
        }}
        placeholder="把你自己写的那一段抄进来"
        rows={4}
      />

      {/* An answer with no 得分点 to check it against is not 0 分, and saying
          so would be scoring work you have not asked it to score. */}
      {points.length > 0 && written ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={checked.hit === checked.total ? "secondary" : "outline"}>
              踩到 {checked.hit} / {checked.total} 个点
            </Badge>
            {checked.hit === checked.total ? (
              <Badge variant="secondary">每个点都踩到了</Badge>
            ) : null}
          </div>

          <ul className="flex flex-col gap-1">
            {checked.points.map((point, index) => (
              <li
                key={`${index}-${point.text}`}
                className={
                  point.verdict === "missing"
                    ? "flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5"
                    : "flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
                }
              >
                {point.verdict === "hit" ? (
                  <Check aria-hidden="true" className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <CircleAlert aria-hidden="true" className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                )}
                <span className="text-sm">{point.text}</span>
                {/* 踩到了 with nothing shown is a claim you cannot check. The
                    snippet is what lets you disagree with the board. */}
                {point.matched !== null ? (
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {point.matched}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {points.length > 0 && written && missing.length > 0 ? (
        <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
          缺的是：{missing.map((point) => point.text).join("、")}
        </p>
      ) : null}
    </div>
  )
}
