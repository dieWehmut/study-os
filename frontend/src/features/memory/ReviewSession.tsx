import { useEffect, useState } from "react"
import { CheckCircle2, Headphones, RotateCcw, Volume2 } from "lucide-react"

import { playPronunciation } from "@/api/audio"
import { answerReview, getDueReviews, overrideAttempt } from "@/api/reviews"
import type { DueReview, ReviewEvaluation } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"

const promptLabels: Record<string, string> = {
  en_to_zh: "看英文，说中文",
  zh_to_en: "看中文，说英文",
  context_cloze: "语境填空",
  make_sentence: "造句（AI 批改）",
}

export function ReviewSession() {
  const [queue, setQueue] = useState<DueReview[]>([])
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState("")
  const [evaluation, setEvaluation] = useState<ReviewEvaluation | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [audioSource, setAudioSource] = useState<"file" | "browser" | "unavailable" | null>(null)

  useEffect(() => {
    let active = true
    getDueReviews()
      .then(({ items }) => {
        if (active) setQueue(items)
      })
      .catch(() => {
        if (active) setError("暂时无法读取复习队列，请确认本地服务正在运行。")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const current = queue[index]
  const isChoicePrompt =
    current?.prompt.prompt_type === "context_cloze" && (current.prompt.options?.length ?? 0) > 0

  async function submitAnswer(payload?: string) {
    const value = payload ?? answer.trim()
    if (!current || !value || submitting) return
    setSubmitting(true)
    setError("")
    try {
      setEvaluation(await answerReview(current.prompt.id, value, undefined))
    } catch {
      setError("答案未能保存，请重试；当前输入不会丢失。")
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
      setError("改判没有保存，请稍后重试。")
    } finally {
      setSubmitting(false)
    }
  }

  function nextPrompt() {
    setIndex((value) => value + 1)
    setAnswer("")
    setEvaluation(null)
    setError("")
  }

  async function speakTerm() {
    if (!current) return
    setAudioSource(await playPronunciation(current.prompt.question))
  }

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">正在整理今天的复习队列…</p>
  }

  if (!current) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CheckCircle2 aria-hidden="true" className="text-primary" />
          <CardTitle>今天的到期内容已经完成</CardTitle>
          <CardDescription>新导入或新学的知识会自动进入这里。</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const progress = queue.length === 0 ? 0 : (index / queue.length) * 100

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">记忆检测</p>
          <p className="text-xs text-muted-foreground">{index + 1} / {queue.length}</p>
        </div>
        <Badge variant="outline">{promptLabels[current.prompt.prompt_type] ?? current.prompt.prompt_type}</Badge>
      </div>
      <Progress value={progress} aria-label="复习进度" />

      <Card className="border-border/80 bg-card/90 shadow-[0_18px_70px_-48px_hsl(var(--primary)/0.65)]">
        <CardHeader className="gap-4 border-b">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{current.knowledge.item_type}</Badge>
            {current.knowledge.level ? <span>{current.knowledge.level}</span> : null}
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-heading text-3xl font-medium sm:text-4xl">{current.prompt.question}</h1>
              {current.knowledge.part_of_speech ? (
                <CardDescription className="mt-2">{current.knowledge.part_of_speech}</CardDescription>
              ) : null}
            </div>
						{current.prompt.prompt_type === "en_to_zh" ? (
							<Button variant="outline" size="icon-lg" aria-label="播放发音" onClick={() => void speakTerm()}>
								<Volume2 aria-hidden="true" />
							</Button>
						) : null}
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 pt-2">
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
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {audioSource === "browser" ? <p className="text-xs text-muted-foreground" role="status">Audio file unavailable; browser speech fallback used.</p> : null}
          {audioSource === "unavailable" ? <p className="text-xs text-muted-foreground" role="status">No pronunciation audio is available.</p> : null}

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
                  {evaluation.outcome === "correct" ? "正确" : evaluation.outcome === "partial" ? "部分正确" : "需要重学"}
                </Badge>
                <span className="text-xs text-muted-foreground">系统他评 · {evaluation.rating === 3 ? "Good" : evaluation.rating === 2 ? "Hard" : "Again"}</span>
              </div>
              <p className="text-sm leading-6">{evaluation.feedback}</p>
              {evaluation.expected_answers.length > 0 ? (
                <p className="text-sm text-muted-foreground">参考答案：{evaluation.expected_answers.join(" / ")}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" aria-label="改判为重来" onClick={() => void correctRating(1)}>改判为重来</Button>
                <Button variant="outline" size="sm" aria-label="改判为较难" onClick={() => void correctRating(2)}>改判为较难</Button>
                <Button variant="outline" size="sm" aria-label="改判为掌握" onClick={() => void correctRating(3)}>改判为掌握</Button>
              </div>
            </div>
          ) : null}
        </CardContent>

        <CardFooter className="justify-between gap-3">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Headphones aria-hidden="true" /> 发音优先使用本地音频
          </span>
          {evaluation ? (
            <Button onClick={nextPrompt}>下一题</Button>
          ) : isChoicePrompt ? null : (
            <Button disabled={!answer.trim() || submitting} onClick={() => void submitAnswer()}>
              {submitting ? <RotateCcw aria-hidden="true" className="animate-spin" /> : null}
              提交答案
            </Button>
          )}
        </CardFooter>
      </Card>
    </section>
  )
}
