import { useEffect, useState } from "react"
import { CheckCircle2, Headphones, LibraryBig, Volume2 } from "lucide-react"
import { Link } from "react-router-dom"

import { playPronunciation } from "@/api/audio"
import { listKnowledge } from "@/api/knowledge"
import { getDueReviews } from "@/api/reviews"
import type { DueReview } from "@/api/types"
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
}

export function ReviewSession({ recovery = false }: ReviewSessionProps) {
  const subject = useSubjectStore((state) => state.subject)
  const [queue, setQueue] = useState<DueReview[]>([])
  const [libraryCount, setLibraryCount] = useState<number | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState("")
  const [audioSource, setAudioSource] = useState<"file" | "browser" | "unavailable" | null>(null)

  // Loading is derived rather than stored so the effect never has to call
  // setState synchronously in its body just to show the spinner again when the
  // subject changes.
  const requestKey = `${subject}|${recovery ? "recovery" : "due"}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== requestKey

  useEffect(() => {
    let active = true
    const subjectFilter = subject === "all" ? undefined : subject
    Promise.all([
      getDueReviews(20, subjectFilter, recovery ? "recovery" : undefined),
      listKnowledge({ subject: subjectFilter, limit: 1 }),
    ])
      .then(([due, library]) => {
        if (!active) return
        setQueue(due.items)
        setLibraryCount(library.count)
        setIndex(0)
      })
      .catch(() => {
        if (active) {
          setError("暂时无法读取复习队列，请确认本地服务正在运行。")
          setLibraryCount(null)
        }
      })
      .finally(() => {
        if (active) setLoadedKey(`${subject}|${recovery ? "recovery" : "due"}`)
      })
    return () => {
      active = false
    }
  }, [subject, recovery])

  const current = queue[index]

  function nextPrompt() {
    setIndex((value) => value + 1)
    setError("")
    setAudioSource(null)
  }

  async function speakTerm() {
    if (!current) return
    setAudioSource(await playPronunciation(current.prompt.question))
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
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <CheckCircle2 aria-hidden="true" className="size-12 text-primary" />
          <div>
            <h2 className="font-heading text-lg font-semibold">今天的到期内容已经完成</h2>
            <p className="mt-1 text-sm text-muted-foreground">新导入或新学的知识会自动进入这里。</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const progress = queue.length === 0 ? 0 : (index / queue.length) * 100
  const isRecognition = recognitionPromptTypes.has(current.prompt.prompt_type)

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-5">
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
              <h1 className="font-heading text-3xl font-medium sm:text-4xl">
                {current.prompt.question}
              </h1>
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
            />
          ) : (
            <ProductionPrompt
              key={current.prompt.id}
              current={current}
              onNext={nextPrompt}
              onError={setError}
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
