import { useEffect, useState, type ReactNode } from "react"
import { CalendarPlus, CheckCheck, PenLine, Scale, Split, SquarePen, Trash2 } from "lucide-react"

import {
  correctMistake,
  deleteMistake,
  listMistakes,
  recordMistake,
  scheduleMistake,
} from "@/api/mistakes"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { EquationBoard } from "@/features/chemistry/EquationBoard"
import { FreeBodyBoard } from "@/features/physics/FreeBodyBoard"
import { MotionBoard } from "@/features/physics/MotionBoard"
import {
  MISTAKE_CAUSES,
  causeActionFor,
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

interface CauseBoard {
  open: string
  close: string
  icon: ReactNode
  board: ReactNode
}

/**
 * The tool that carries out one subject's advice for one cause, if there is one.
 *
 * Keyed by subject and cause because that is exactly how `causeActionFor`
 * chooses the sentence, and the two must not drift: a board offered where the
 * sentence does not ask for it is as wrong as a sentence asking for a board
 * that is not there.
 *
 * Deliberately not part of SUBJECT_CAUSE_ACTIONS -- that table returns strings
 * and is imported by code with no React in scope. Most pairs have no board, and
 * that is the normal case, not a gap.
 */
function boardFor(subject: string, cause: MistakeCause): CauseBoard | null {
  if (subject === "chemistry" && cause === "careless") {
    return {
      open: "核对配平",
      close: "收起配平",
      icon: <Scale data-icon="inline-start" />,
      board: <EquationBoard />,
    }
  }
  if (subject !== "physics") return null
  if (cause === "method") {
    return {
      open: "画受力图",
      close: "收起受力图",
      icon: <PenLine data-icon="inline-start" />,
      board: <FreeBodyBoard />,
    }
  }
  if (cause === "misread") {
    return {
      open: "把过程分段",
      close: "收起分段",
      icon: <Split data-icon="inline-start" />,
      board: <MotionBoard />,
    }
  }
  return null
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
  // Shared by every action that acts on one row -- 排进复习 and 订正 both fail
  // the same way, and one line under the list is where you are already looking.
  const [rowError, setRowError] = useState("")
  const [queueing, setQueueing] = useState("")
  const [correcting, setCorrecting] = useState("")
  const [busy, setBusy] = useState(false)
  // Which cause row has its drawing board open, "" for none. A cause rather
  // than a flag: the row is the reason the board is on screen, and a second
  // executable piece of advice would need to say which one it belongs to.
  const [drawing, setDrawing] = useState<MistakeCause | "">("")

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

  /**
   * Put one 想不起来 back in the review queue.
   *
   * The answer the server gives is the id of the library entry the question
   * became, and that id is stored on the row itself rather than in a separate
   * "queued" set: it is the same field the list carries after a reload, so
   * there is one thing to be right about instead of two that can disagree.
   *
   * A failure leaves the button pressable and says so next to the list. An
   * error shown up in 记一笔 would be off-screen for exactly the row you were
   * pressing.
   */
  async function queue(item: MistakeRecord) {
    if (queueing) return
    setQueueing(item.id)
    try {
      const knowledgeItemId = await scheduleMistake(item.id)
      setRecords((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, knowledgeItemId } : entry)),
      )
      setRowError("")
    } catch (failure) {
      setRowError(describe(failure, "排进复习失败"))
    } finally {
      setQueueing("")
    }
  }

  /**
   * Mark one filed mistake as one you have since got right.
   *
   * Deliberately not remove(): 取消 is for a row filed by accident, 订正 is for
   * a mistake you fixed, and the row has to stay -- "I got this wrong once and
   * put it right" is the sentence the log exists to be able to say.
   *
   * Only the mark is merged onto the row we already hold. The server answers
   * with the whole record, but taking it wholesale would let a rewrite of the
   * question text land under your cursor as the side effect of a press.
   */
  async function correct(item: MistakeRecord) {
    if (correcting) return
    setCorrecting(item.id)
    try {
      const fixed = await correctMistake(item.id)
      setRecords((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, corrected: fixed.corrected } : entry,
        ),
      )
      setRowError("")
    } catch (failure) {
      setRowError(describe(failure, "订正失败"))
    } finally {
      setCorrecting("")
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
              {/* Counted beside the split, never taken out of it: a bar that
                  shrank on 订正 would erase the diagnosis as a reward for
                  acting on it. */}
              {summary.corrected > 0 ? (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                  已订正 {summary.corrected}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {summary.byCause.map(({ spec, count, percent }) => {
              const board = boardFor(subject, spec.cause)
              return (
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
                {/* The sentence is the subject's own where that subject can
                    put it better -- 物理's 思路不对 means the wrong model, and
                    the fix is a drawing, not two more problems. */}
                <p className="text-xs text-muted-foreground">
                  {causeActionFor(subject, spec.cause)}
                </p>
                {/* Only where the sentence above actually asks for one.
                    语文's 默写 asks for nothing that can be drawn, and a board
                    offered there would be the generic advice the per-subject
                    table was written to end. */}
                {board ? (
                  <div className="flex flex-col gap-2 pt-1">
                    <Button
                      type="button"
                      size="xs"
                      variant={drawing === spec.cause ? "secondary" : "outline"}
                      className="self-start"
                      onClick={() => setDrawing((open) => (open === spec.cause ? "" : spec.cause))}
                    >
                      {board.icon}
                      {drawing === spec.cause ? board.close : board.open}
                    </Button>
                    {drawing === spec.cause ? board.board : null}
                  </div>
                ) : null}
              </div>
              )
            })}
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
                    {/* Offered on 想不起来 alone. Rescheduling a card you
                        misread, or ran out of time on, reshuffles something
                        that was never the problem -- and the row already says
                        what to do instead. */}
                    {item.knowledgeItemId ? (
                      <span className="shrink-0 text-xs text-muted-foreground">已排进复习</span>
                    ) : spec?.reviewFixes ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={queueing === item.id}
                        onClick={() => void queue(item)}
                      >
                        <CalendarPlus aria-hidden="true" />
                        排进复习
                      </Button>
                    ) : null}
                    {/* Offered on every cause: a 手滑 you have learned to catch
                        is as much a fixed mistake as a word you finally learnt.
                        Independent of 排进复习 -- having put one instance right
                        is not a reason to stop being asked. */}
                    {item.corrected ? (
                      <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">
                        已订正
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        disabled={correcting === item.id}
                        onClick={() => void correct(item)}
                      >
                        <CheckCheck aria-hidden="true" />
                        订正
                      </Button>
                    )}
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
          {rowError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {rowError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}
