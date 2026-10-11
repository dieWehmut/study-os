import { RotateCcw } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { answerReview, overrideAttempt } from "@/api/reviews"
import type { DueReview, ReviewEvaluation } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface ProductionPromptProps {
  current: DueReview
  onNext: () => void
  onError: (message: string) => void
  /** Told whenever this card's verdict changes, overrides included. */
  onRated?: (outcome: ReviewEvaluation["outcome"]) => void
}

export function ProductionPrompt({ current, onNext, onError, onRated }: ProductionPromptProps) {
  const [answer, setAnswer] = useState("")
  const [evaluation, setEvaluation] = useState<ReviewEvaluation | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isChoicePrompt =
    current.prompt.prompt_type === "context_cloze" && (current.prompt.options?.length ?? 0) > 0

  // Stable so the key listener is not torn down and rebuilt on every render.
  const submitAnswer = useCallback(async (payload?: string) => {
    const value = payload ?? answer.trim()
    if (!value || submitting) return
    setSubmitting(true)
    try {
      const graded = await answerReview(current.prompt.id, value, undefined)
      setEvaluation(graded)
      onRated?.(graded.outcome)
    } catch {
      onError("答案未能保存，请重试；当前输入不会丢失。")
    } finally {
      setSubmitting(false)
    }
  }, [answer, current.prompt.id, onError, onRated, submitting])

  const correctRating = useCallback(async (rating: 1 | 2 | 3) => {
    if (!evaluation || submitting) return
    setSubmitting(true)
    try {
      // A 改判 replaces the verdict, so the round's tally is told again and
      // corrects itself rather than counting the card twice.
      const overridden = await overrideAttempt(evaluation.attempt_id, rating)
      setEvaluation(overridden)
      onRated?.(overridden.outcome)
    } catch {
      onError("改判没有保存，请稍后重试。")
    } finally {
      setSubmitting(false)
    }
  }, [evaluation, onError, onRated, submitting])

  // One listener for the life of the card, reading the newest handler through a ref.
  //
  // Registering the listener per render (with the state in its closure) lost a
  // press: between the verdict landing and the effect re-running there is a window
  // where the old closure still believes nothing has been answered, so "1" for a
  // 改判 was read as "no evaluation, not a choice card" and dropped. A layout effect
  // closes that window -- it runs in the same commit, before any event can arrive.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {})
  useLayoutEffect(() => {
    keyHandler.current = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      if (evaluation) {
        if (event.key === "Enter") {
          event.preventDefault()
          onNext()
          return
        }
        const rating = { "1": 1, "2": 2, "3": 3 }[event.key] as 1 | 2 | 3 | undefined
        if (!rating || submitting) return
        event.preventDefault()
        void correctRating(rating)
        return
      }
      if (!isChoicePrompt || submitting) return
      const index = Number(event.key) - 1
      const option = current.prompt.options?.[index]
      if (!option) return
      event.preventDefault()
      void submitAnswer(option)
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

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
          <>
            {/* Drilling: say the keys instead of leaving them to be discovered. */}
            <p className="mr-auto self-center text-xs text-muted-foreground">键盘：1/2/3 改判 · 回车下一题</p>
            <Button onClick={onNext}>下一题</Button>
          </>
        ) : isChoicePrompt ? (
          <p className="text-xs text-muted-foreground">键盘：按 1–{current.prompt.options?.length ?? 0} 选择</p>
        ) : (
          <Button disabled={!answer.trim() || submitting} onClick={() => void submitAnswer()}>
            {submitting ? <RotateCcw aria-hidden="true" className="animate-spin" /> : null}
            提交答案
          </Button>
        )}
      </div>
    </>
  )
}
