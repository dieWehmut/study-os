import { useEffect, useState } from "react"
import { SquarePen, Trash2 } from "lucide-react"

import { deleteMistake, listMistakes, recordMistake } from "@/api/mistakes"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  MISTAKE_CAUSES,
  clearStoredMistakes,
  readMistakes,
  summarizeMistakes,
  type MistakeCause,
  type MistakeRecord,
} from "@/lib/mistakes"
import { useSubjectStore } from "@/store/useSubjectStore"

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * Carry a log filed before the page had a backend into the database.
 *
 * Everything logged in the localStorage era is invisible to the rest of the
 * system -- the review queue cannot see it, another device cannot see it.
 * Dropping it would punish whoever used the feature first.
 *
 * Oldest first, so that prepending each answer leaves the newest on top. The
 * key is removed only after every row is through: clearing it on a failed
 * write would lose them for good, while leaving it costs one retry.
 */
async function carryBrowserLogOver(): Promise<MistakeRecord[]> {
  const stored = readMistakes()
  if (stored.length === 0) return []

  const carried: MistakeRecord[] = []
  for (const record of [...stored].reverse()) {
    carried.unshift(
      await recordMistake({
        subject: record.subject,
        question: record.question,
        cause: record.cause,
        ...(record.note ? { note: record.note } : {}),
      }),
    )
  }
  clearStoredMistakes()
  return carried
}

export default function Practice() {
  const subject = useSubjectStore((state) => state.subject)
  const [question, setQuestion] = useState("")
  const [records, setRecords] = useState<MistakeRecord[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  // The log follows the 首页 switch like every other list in the app: while you
  // are working through 物理, 地理 mistakes are noise.
  //
  // The `active` guard is what keeps a slow answer for the subject you just
  // left from landing on top of the one you switched to.
  useEffect(() => {
    let active = true
    listMistakes(subject === "all" ? {} : { subject })
      .then((loaded) => {
        if (!active) return []
        setRecords(loaded)
        setError("")
        return carryBrowserLogOver()
      })
      .then((carried) => {
        if (!active || carried.length === 0) return
        setRecords((current) => [...carried, ...current])
      })
      .catch((failure: unknown) => {
        if (active) setError(describe(failure, "读取错题失败"))
      })
    return () => {
      active = false
    }
  }, [subject])

  const summary = summarizeMistakes(records)
  const pending = question.trim()

  // Picking the cause is the save. A separate 保存 button would be a third
  // action at the moment you least want one -- right after getting something
  // wrong, when the cheapest path is to log nothing at all.
  //
  // The row only appears once the write came back. A row that looks filed when
  // nothing was written is worse than one that failed loudly: the box keeps
  // what you typed, so the retry costs nothing.
  async function file(cause: MistakeCause) {
    if (!pending || busy) return
    setBusy(true)
    try {
      const filed = await recordMistake({ subject, question: pending, cause })
      setRecords((current) => [filed, ...current])
      setQuestion("")
      setError("")
    } catch (failure) {
      setError(describe(failure, "记录错题失败"))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    try {
      await deleteMistake(id)
      setRecords((current) => current.filter((entry) => entry.id !== id))
      setError("")
    } catch (failure) {
      setError(describe(failure, "删除错题失败"))
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <SquarePen aria-hidden="true" className="size-4 text-primary" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight">练习</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          错了不只要记住，还要知道错在哪一层 —— 有些错，再复习一遍也不会好。
        </p>
      </div>

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>记一笔</CardTitle>
          <p className="text-sm text-muted-foreground">写下是哪道题，然后选一个错因，就存下了。</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            aria-label="错题"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="哪道题？一句话就够"
          />
          <div className="flex flex-wrap gap-2">
            {MISTAKE_CAUSES.map((spec) => (
              <Button
                key={spec.cause}
                variant="outline"
                size="sm"
                disabled={!pending || busy}
                onClick={() => void file(spec.cause)}
              >
                {spec.label}
              </Button>
            ))}
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      {summary.total > 0 ? (
        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle>错在哪一层</CardTitle>
            {/* The rest of the app answers every wrong answer with "see it
                again sooner". This split is what says when that answer is
                wrong -- and what to do instead. */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">复习能解决 {summary.reviewFixable}</Badge>
              <Badge variant="outline">另有原因 {summary.needsOtherFix}</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {summary.byCause.map(({ spec, count, percent }) => (
              <div key={spec.cause} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{spec.label}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                  <span className="ml-auto tabular-nums text-xs text-muted-foreground">
                    {percent}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={spec.reviewFixes ? "h-full bg-primary" : "h-full bg-amber-500"}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{spec.action}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>记录</CardTitle>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              还没有记录。做错一题就来记一笔，比考前翻整本书管用。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {records.map((item) => {
                const spec = MISTAKE_CAUSES.find((entry) => entry.cause === item.cause)
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg border bg-muted/25 px-3 py-2"
                  >
                    <span className="truncate text-sm">{item.question}</span>
                    <Badge
                      variant={spec?.reviewFixes ? "secondary" : "outline"}
                      className="ml-auto shrink-0"
                    >
                      {spec?.label}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="删除"
                      onClick={() => void remove(item.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
