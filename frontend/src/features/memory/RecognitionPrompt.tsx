import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { submitSelfRating } from "@/api/reviews"
import type { DueReview, ReviewEvaluation } from "@/api/types"
import { Button } from "@/components/ui/button"

const ratings: { value: 1 | 2 | 3; label: string; variant: "outline" | "default" }[] = [
  { value: 1, label: "不认识", variant: "outline" },
  { value: 2, label: "模糊", variant: "outline" },
  { value: 3, label: "认识", variant: "default" },
]

interface RecognitionPromptProps {
  current: DueReview
  onNext: () => void
  onError: (message: string) => void
  /** Told once per card, so the session can say how the round went. */
  onRated?: (outcome: ReviewEvaluation["outcome"]) => void
}

export function RecognitionPrompt({ current, onNext, onError, onRated }: RecognitionPromptProps) {
  const [evaluation, setEvaluation] = useState<ReviewEvaluation | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Stable so the key listener is not torn down and rebuilt on every render.
  const rate = useCallback(async (value: 1 | 2 | 3) => {
    if (submitting || evaluation) return
    setSubmitting(true)
    try {
      const rated = await submitSelfRating(current.prompt.id, value)
      setEvaluation(rated)
      onRated?.(rated.outcome)
    } catch {
      onError("评分未能保存，请重试。")
    } finally {
      setSubmitting(false)
    }
  }, [current.prompt.id, evaluation, onError, onRated, submitting])

  // One listener for the life of the card, reading the newest handler through a ref.
  //
  // The same race the fill-in card had: a listener registered per render keeps the
  // state it closed over, so between the verdict appearing and the effect re-running
  // there is a window where the old closure still believes nothing was answered --
  // and Enter for 下一题 is swallowed. A layout effect runs in the same commit, so no
  // event can arrive in that window.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {})
  useLayoutEffect(() => {
    keyHandler.current = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      if (evaluation) {
        if (event.key !== "Enter") return
        event.preventDefault()
        onNext()
        return
      }
      const rating = { "1": 1, "2": 2, "3": 3 }[event.key] as 1 | 2 | 3 | undefined
      if (!rating || submitting) return
      event.preventDefault()
      void rate(rating)
    }
  })

  // Typing into a field is not a shortcut, and a card being rated twice is not a
  // rating: the handler above stands down for both.
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

  return (
    <>
      {evaluation ? (
        <div
          className="flex flex-col gap-1 rounded-xl border border-primary/25 bg-primary/5 p-4"
          aria-live="polite"
        >
          <p className="text-xs text-muted-foreground">参考答案</p>
          {evaluation.expected_answers.length > 0 ? (
            <p className="text-lg font-medium">{evaluation.expected_answers.join(" / ")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">这张卡片没有登记参考答案。</p>
          )}
        </div>
      ) : (
        <fieldset className="grid gap-2" aria-label="自评掌握程度">
          <legend className="text-sm font-medium">先在心里回答，再选择你的掌握程度</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {ratings.map(({ value, label, variant }) => (
              <Button
                key={value}
                type="button"
                variant={variant}
                size="lg"
                disabled={submitting}
                onClick={() => void rate(value)}
                className="h-12"
              >
                {label}
              </Button>
            ))}
          </div>
          {/* Drilling is repetitive by design, so the keys are worth saying out loud. */}
          <p className="text-xs text-muted-foreground">键盘：1 不认识 · 2 模糊 · 3 认识</p>
        </fieldset>
      )}

      <div className="flex justify-end">
        {evaluation ? (
          <>
            <p className="mr-auto self-center text-xs text-muted-foreground">回车进入下一题</p>
            <Button onClick={onNext}>下一题</Button>
          </>
        ) : null}
      </div>
    </>
  )
}
