import { RotateCcw } from "lucide-react"
import { useState } from "react"

import { answerReview, overrideAttempt } from "@/api/reviews"
import type { DueReview, ReviewEvaluation } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface ProductionPromptProps {
  current: DueReview
  onNext: () => void
  onError: (message: string) => void
}

export function ProductionPrompt({ current, onNext, onError }: ProductionPromptProps) {
  const [answer, setAnswer] = useState("")
  const [evaluation, setEvaluation] = useState<ReviewEvaluation | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isChoicePrompt =
    current.prompt.prompt_type === "context_cloze" && (current.prompt.options?.length ?? 0) > 0

  async function submitAnswer(payload?: string) {
    const value = payload ?? answer.trim()
    if (!value || submitting) return
    setSubmitting(true)
    try {
      setEvaluation(await answerReview(current.prompt.id, value, undefined))
    } catch {
      onError("答案未能保存，请重试；当前输入不会丢失。")
    } finally {
      setSubmitting(false)
    }
  }

  async function correctRating(rating: 1 | 2 | 3) {
    if (!evaluation || submitting) return
    setSubmitting(true)
    try {
      setEvaluation(await overrideAttempt(evaluation.attempt_id, rating))
    } catch {
      onError("改判没有保存，请稍后重试。")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {isChoicePrompt ? (
        <fieldset className="grid gap-2" aria-label="选择答案">
          <legend className="text-sm font-medium">选一个最合适的词</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {current.prompt.options?.map((option) => {
              const isCorrect = evaluation?.expected_answers.includes(option) ?? false
              return (
                <Button
                  key={option}
                  type="button"
                  variant={isCorrect ? "default" : "outline"}
                  size="lg"
                  disabled={Boolean(evaluation) || submitting}
                  onClick={() => void submitAnswer(option)}
                  className="h-12 justify-start px-4 font-mono text-sm"
                >
                  {option}
                </Button>
              )
            })}
          </div>
        </fieldset>
      ) : (
        <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="review-answer">
          你的答案
          <Textarea
            id="review-answer"
            value={answer}
            disabled={Boolean(evaluation)}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submitAnswer()
            }}
            placeholder="写下你真正能说出的答案（Ctrl + Enter 提交）"
            className="min-h-28 resize-y text-base"
          />
        </label>
      )}

      {evaluation ? (
        <div
          className={
            evaluation.outcome === "correct"
              ? "flex flex-col gap-4 rounded-xl border border-primary/25 bg-primary/5 p-4"
              : evaluation.outcome === "partial"
                ? "flex flex-col gap-4 rounded-xl border border-accent/45 bg-accent/20 p-4"
                : "flex flex-col gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
          }
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            <Badge variant={evaluation.outcome === "incorrect" ? "destructive" : "default"}>
              {evaluation.outcome === "correct"
                ? "正确"
                : evaluation.outcome === "partial"
                  ? "部分正确"
                  : "需要重学"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              系统他评 · {evaluation.rating === 3 ? "良好" : evaluation.rating === 2 ? "困难" : "重来"}
            </span>
          </div>
          <p className="text-sm leading-6">{evaluation.feedback}</p>
          {evaluation.expected_answers.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              参考答案：{evaluation.expected_answers.join(" / ")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" aria-label="改判为重来" onClick={() => void correctRating(1)}>
              改判为重来
            </Button>
            <Button variant="outline" size="sm" aria-label="改判为较难" onClick={() => void correctRating(2)}>
              改判为较难
            </Button>
            <Button variant="outline" size="sm" aria-label="改判为掌握" onClick={() => void correctRating(3)}>
              改判为掌握
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        {evaluation ? (
          <Button onClick={onNext}>下一题</Button>
        ) : isChoicePrompt ? null : (
          <Button disabled={!answer.trim() || submitting} onClick={() => void submitAnswer()}>
            {submitting ? <RotateCcw aria-hidden="true" className="animate-spin" /> : null}
            提交答案
          </Button>
        )}
      </div>
    </>
  )
}
