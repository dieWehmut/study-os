import { useState } from "react"

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
}

export function RecognitionPrompt({ current, onNext, onError }: RecognitionPromptProps) {
  const [evaluation, setEvaluation] = useState<ReviewEvaluation | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function rate(value: 1 | 2 | 3) {
    if (submitting || evaluation) return
    setSubmitting(true)
    try {
      setEvaluation(await submitSelfRating(current.prompt.id, value))
    } catch {
      onError("评分未能保存，请重试。")
    } finally {
      setSubmitting(false)
    }
  }

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
        </fieldset>
      )}

      <div className="flex justify-end">
        {evaluation ? <Button onClick={onNext}>下一题</Button> : null}
      </div>
    </>
  )
}
