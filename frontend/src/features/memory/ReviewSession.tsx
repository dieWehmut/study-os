import { useEffect, useState } from "react"
import { CheckCircle2, Headphones, LibraryBig, Volume2 } from "lucide-react"
import { Link } from "react-router-dom"

import { playPronunciation } from "@/api/audio"
import { listKnowledge } from "@/api/knowledge"
import { getDueReviews } from "@/api/reviews"
import type { DueReview, ReviewEvaluation } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { failureMessage } from "@/lib/errors"
import { subjectName } from "@/lib/subjects"
import { useSettingsStore } from "@/store/useSettingsStore"
import { Progress } from "@/components/ui/progress"
import { itemTypeLabel } from "@/lib/labels"
import { SubjectBadge } from "@/features/subjects/SubjectBadge"
import { useSubjectStore } from "@/store/useSubjectStore"
import { ProductionPrompt } from "./ProductionPrompt"
import { RecognitionPrompt } from "./RecognitionPrompt"

const promptLabels: Record<string, string> = {
  en_to_zh: "看英文，说中文",
  zh_to_en: "看中文，说英文",
  context_cloze: "语境填空",
  make_sentence: "造句（AI 批改）",
  definition_recall: "看词说定义",
  definition_term: "看定义说词",
  formula_recall: "默写公式",
  verse_fill: "上下句背诵",
}

// Recognition is self-graded: the learner judges their own recall and the
// answer is revealed by the rating response. Every other prompt type is
// production practice, where typing the answer is the learning signal.
const recognitionPromptTypes = new Set(["en_to_zh"])

interface ReviewSessionProps {
  recovery?: boolean
  /** Fires after each answered card so the page can refresh its counters. */
  onProgress?: () => void
}

export function ReviewSession({ recovery = false, onProgress }: ReviewSessionProps) {
  const subject = useSubjectStore((state) => state.subject)
  // 「每日记忆上限」 was stored, validated, and shown on the settings page while
  // nothing read it: the session always asked for 20. It is the size of today's
  // queue, which is what the setting says it limits.
  const dailyLimit = useSettingsStore((state) => state.settings.dailyLimit)
  const [queue, setQueue] = useState<DueReview[]>([])
  const [libraryCount, setLibraryCount] = useState<number | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState("")
  // How this round went, keyed by card: a 改判 replaces the card's verdict instead
  // of counting it twice, so the session can say what it just did.
  const [outcomes, setOutcomes] = useState<Record<string, ReviewEvaluation["outcome"]>>({})
  const [audioSource, setAudioSource] = useState<"file" | "browser" | "unavailable" | null>(null)

  // Loading is derived rather than stored so the effect never has to call
  // setState synchronously in its body just to show the spinner again when the
  // subject changes.
  const requestKey = `${subject}|${recovery ? "recovery" : "due"}|${dailyLimit}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== requestKey

  useEffect(() => {
    let active = true
    const subjectFilter = subject === "all" ? undefined : subject
    Promise.all([
      getDueReviews(dailyLimit, subjectFilter, recovery ? "recovery" : undefined),
      listKnowledge({ subject: subjectFilter, limit: 1 }),
    ])
      .then(([due, library]) => {
        if (!active) return
        setQueue(due.items)
        setLibraryCount(library.count)
        setIndex(0)
        setOutcomes({})
      })
      .catch((reason) => {
        if (active) {
          setError(failureMessage(reason, "无法读取复习队列"))
          setLibraryCount(null)
        }
      })
      .finally(() => {
        if (active) setLoadedKey(`${subject}|${recovery ? "recovery" : "due"}|${dailyLimit}`)
      })
    return () => {
      active = false
    }
  }, [subject, recovery, dailyLimit])

  const current = queue[index]

  function nextPrompt() {
    setIndex((value) => value + 1)
    setError("")
    setAudioSource(null)
    onProgress?.()
  }

  async function speakTerm() {
    if (!current) return
    setAudioSource(await playPronunciation(current.prompt.question))
  }

  // A second pass over the cards that did not land. The refused ones are asked
  // again as a fresh round: the tally starts over, so what it reports afterwards
  // is the retry, not the original round.
  function redoMissed(items: DueReview[]) {
    if (items.length === 0) return
    setError("")
    setOutcomes({})
    setQueue(items)
    setIndex(0)
  }

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">正在整理今天的复习队列…</p>
  }

  if (error && libraryCount === null) {
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>无法连接</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (libraryCount === 0) {
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <LibraryBig aria-hidden="true" className="size-12 text-muted-foreground" />
          <div>
            <h2 className="font-heading text-lg font-semibold">这个科目还没有任何内容</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              先导入词表或笔记，系统会自动为每条内容排好复习计划。
            </p>
          </div>
          <Link to="/import" className={buttonVariants({ variant: "default" })}>
            去导入
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (!current) {
    const verdicts = Object.values(outcomes)
    const counts = {
      correct: verdicts.filter((outcome) => outcome === "correct").length,
      partial: verdicts.filter((outcome) => outcome === "partial").length,
      incorrect: verdicts.filter((outcome) => outcome === "incorrect").length,
    }
    // The cards this round did not land. Re-asking them right here is the whole
    // point of noticing: the schedule pushes them out by days, and by then the
    // wrong answer is all that is remembered.
    const toRedo = queue.filter((item) => {
      const outcome = outcomes[item.prompt.id]
      return outcome === "incorrect" || outcome === "partial"
    })
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <CheckCircle2 aria-hidden="true" className="size-12 text-primary" />
          <div>
            <h2 className="font-heading text-lg font-semibold">
              {/* The chips narrow the queue, so "today is done" has to say whose
                  today: a reader with 物理 selected would otherwise take it as the
                  whole day and stop. */}
              {subject === "all" ? "今天的到期内容已经完成" : `「${subjectName(subject)}」今天的到期内容已经完成`}
            </h2>
            {/* What this round actually was: finishing 20 cards and finishing none
                looked identical, and the second is not an achievement. */}
            {verdicts.length > 0 ? (
              <p className="mt-2 text-sm text-foreground" data-round-tally="true">
                这一轮做了 {verdicts.length} 张：
                {[
                  counts.correct > 0 ? `正确 ${counts.correct}` : "",
                  counts.partial > 0 ? `部分正确 ${counts.partial}` : "",
                  counts.incorrect > 0 ? `需要重学 ${counts.incorrect}` : "",
                ].filter(Boolean).join("、")}
              </p>
            ) : null}
            {/* The same numbers as a picture. Three widths against one another say
                "most of this round was solid" or "half of it was guesses" faster than
                the sentence above does, and this is the moment the round is judged. */}
            {verdicts.length > 0 ? (
              <div className="mt-3 grid w-full gap-1.5" data-round-bars="true">
                {([
                  { key: "correct", label: "正确", count: counts.correct, className: "bg-primary" },
                  { key: "partial", label: "部分正确", count: counts.partial, className: "bg-accent-foreground/60" },
                  { key: "incorrect", label: "需要重学", count: counts.incorrect, className: "bg-destructive/70" },
                ] as const).filter((row) => row.count > 0).map((row) => (
                  <div key={row.key} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 text-muted-foreground">{row.label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={`block h-full ${row.className}`}
                        style={{ width: `${Math.round((row.count / verdicts.length) * 100)}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums">{row.count}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="mt-1 text-sm text-muted-foreground">
              新导入或新学的知识会自动进入这里；还没排复习的知识点不会自己进来。
            </p>
          </div>
          {toRedo.length > 0 ? (
            <Button onClick={() => redoMissed(toRedo)}>
              再练这 {toRedo.length} 张
            </Button>
          ) : null}
          {/* Finishing today's cards is the moment the gap is visible: an item
              carrying no cards can never surface here, so point at the ones
              that are not in the plan at all instead of stopping at "done". */}
          <Link to="/knowledge?scheduled=no" className={buttonVariants({ variant: "outline" })}>
            去整理还没排复习的知识点
          </Link>
        </CardContent>
      </Card>
    )
  }

  const progress = queue.length === 0 ? 0 : (index / queue.length) * 100
  const isRecognition = recognitionPromptTypes.has(current.prompt.prompt_type)

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">记忆检测</p>
          <p className="text-xs text-muted-foreground">
            {index + 1} / {queue.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {subject !== "all" ? <SubjectBadge subject={subject} /> : null}
          <Badge variant="outline">
            {promptLabels[current.prompt.prompt_type] ?? current.prompt.prompt_type}
          </Badge>
        </div>
      </div>
      <Progress value={progress} aria-label="复习进度" />

      <Card className="border-border/80 bg-card/90">
        <CardHeader className="gap-4 border-b">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{itemTypeLabel(current.knowledge.item_type)}</Badge>
            {current.knowledge.level ? <span>{current.knowledge.level}</span> : null}
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              {/* h2, not h1: the page already owns its title, and a second h1
                  flattens the document outline for screen-reader users. */}
              <h2 className="font-heading text-3xl font-medium sm:text-4xl">
                {current.prompt.question}
              </h2>
              {current.knowledge.part_of_speech ? (
                <CardDescription className="mt-2">
                  {current.knowledge.part_of_speech}
                </CardDescription>
              ) : null}
            </div>
            {current.prompt.prompt_type === "en_to_zh" ? (
              <Button
                variant="outline"
                size="icon-lg"
                aria-label="播放发音"
                onClick={() => void speakTerm()}
              >
                <Volume2 aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 pt-2">
          {isRecognition ? (
            <RecognitionPrompt
              key={current.prompt.id}
              current={current}
              onNext={nextPrompt}
              onError={setError}
              onRated={(outcome) => setOutcomes((tally) => ({ ...tally, [current.prompt.id]: outcome }))}
            />
          ) : (
            <ProductionPrompt
              key={current.prompt.id}
              current={current}
              onNext={nextPrompt}
              onError={setError}
              onRated={(outcome) => setOutcomes((tally) => ({ ...tally, [current.prompt.id]: outcome }))}
            />
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {audioSource === "browser" ? (
            <p className="text-xs text-muted-foreground" role="status">
              本地音频不可用，已改用浏览器朗读。
            </p>
          ) : null}
          {audioSource === "unavailable" ? (
            <p className="text-xs text-muted-foreground" role="status">
              没有可用的发音音频。
            </p>
          ) : null}
        </CardContent>

        <CardFooter>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Headphones aria-hidden="true" /> 发音优先使用本地音频
          </span>
        </CardFooter>
      </Card>
    </section>
  )
}
