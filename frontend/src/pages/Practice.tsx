import { useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import {
  CalendarPlus,
  CheckCheck,
  ClipboardCheck,
  Download,
  Link2,
  ListOrdered,
  PenLine,
  Scale,
  Scissors,
  Split,
  SquarePen,
  Trash2,
} from "lucide-react"

import {
  correctMistake,
  deleteMistake,
  exportMistakes,
  listMistakePage,
  recordMistake,
  scheduleMistake,
} from "@/api/mistakes"
import { listErrorCauses, type ErrorCause } from "@/api/error-causes"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { EquationBoard } from "@/features/chemistry/EquationBoard"
import { ScoringBoard } from "@/features/chinese/ScoringBoard"
import { LongSentenceBoard } from "@/features/english/LongSentenceBoard"
import { ChainBoard } from "@/features/geography/ChainBoard"
import { DerivationBoard } from "@/features/math/DerivationBoard"
import { MistakeCauseEditor } from "@/features/mistake/MistakeCauseEditor"
import { SubjectEvidenceEditor } from "@/features/mistake/SubjectEvidenceEditor"
import { SubjectDiagnosticSummary } from "@/features/mistake/SubjectDiagnosticSummary"
import { subjectEvidenceToolFor } from "@/features/mistake/subject-evidence"
import { SubjectPrescriptionPanel } from "@/features/subjects/SubjectPrescriptionPanel"
import { FreeBodyBoard } from "@/features/physics/FreeBodyBoard"
import { MotionBoard } from "@/features/physics/MotionBoard"
import {
  MISTAKE_CAUSES,
  causeActionFor,
  causeSpecFor,
  clearStoredMistakes,
  mergeMistakeCauses,
  readMistakes,
  summarizeMistakes,
  type MistakeCause,
  type MistakeCauseSpec,
  type MistakeRecord,
} from "@/lib/mistakes"
import { summarizeMistakeDiagnostics } from "@/lib/mistake-diagnostics"
import { saveTextFile } from "@/lib/download"
import { isStaticDemo } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { failureMessage } from "@/lib/errors"
import { useSubjectStore } from "@/store/useSubjectStore"

// Anything but the two known values means "no filter": a hand-edited link must not
// hand the server a value it will reject.
function correctedFromSearch(value: string | null): "" | "yes" | "no" {
  return value === "yes" || value === "no" ? value : ""
}

function taxonomySpecs(causes: ErrorCause[]): MistakeCauseSpec[] {
  return mergeMistakeCauses(
    causes.map((cause) => ({
      cause: cause.id,
      label: cause.label,
      reviewFixes: cause.reviewFixes,
      action: cause.action,
    })),
  )
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
  if (subject === "chinese" && cause === "method") {
    return {
      open: "对得分点",
      close: "收起得分点",
      icon: <ClipboardCheck data-icon="inline-start" />,
      board: <ScoringBoard />,
    }
  }
  if (subject === "english" && cause === "method") {
    return {
      open: "拆长难句",
      close: "收起长难句",
      icon: <Scissors data-icon="inline-start" />,
      board: <LongSentenceBoard />,
    }
  }
  if (subject === "geography" && cause === "method") {
    return {
      open: "串因果链",
      close: "收起因果链",
      icon: <Link2 data-icon="inline-start" />,
      board: <ChainBoard />,
    }
  }
  if (subject === "math" && cause === "method") {
    return {
      open: "逐行核对",
      close: "收起核对",
      icon: <ListOrdered data-icon="inline-start" />,
      board: <DerivationBoard />,
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
        ...(record.evidence ? { evidence: record.evidence } : {}),
      }),
    )
  }
  clearStoredMistakes()
  return carried
}

export default function Practice() {
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)
  const [question, setQuestion] = useState("")
  const [records, setRecords] = useState<MistakeRecord[]>([])
  const [diagnosticRecords, setDiagnosticRecords] = useState<MistakeRecord[]>([])
  const pendingLocalRecords = useRef<MistakeRecord[]>([])
  const [taxonomy, setTaxonomy] = useState<MistakeCauseSpec[]>(MISTAKE_CAUSES)
  const [error, setError] = useState("")
  // What the last 记一笔 actually filed. Clearing the box is the same signal
  // whether the write landed or you backspaced it yourself.
  const [filedNotice, setFiledNotice] = useState("")
  // The query the log is filtered by, and the box you type in. The log is one
  // page of the newest mistakes, so without this the rest are unreachable.
  const [recordQuery, setRecordQuery] = useState("")
  // One 错因 at a time, filtered by the server so the total narrows with the list.
  const [recordCause, setRecordCause] = useState("")
  // 订正 state as a filter, not just a number: "what is still open" is the list a
  // reader actually wants before a test, and it is the same condition the progress bar
  // counts. It also lives in the URL, so another page can send you here already
  // filtered -- the dashboard does exactly that with "还有 K 条错题没订正".
  const [searchParams, setSearchParams] = useSearchParams()
  const [recordCorrected, setRecordCorrected] = useState<"" | "yes" | "no">(
    correctedFromSearch(searchParams.get("corrected")),
  )
  const [recordDraft, setRecordDraft] = useState("")
  // How many rows the log holds, and how many of them came from the server --
  // counted apart because 记录 also carries a browser log that was migrated over
  // and rows filed since the page opened, neither of which the next offset is
  // about.
  const [recordTotal, setRecordTotal] = useState(0)
  const [serverRecords, setServerRecords] = useState(0)
  const [loadingMoreRecords, setLoadingMoreRecords] = useState(false)
  // Shared by every action that acts on one row -- 排进复习 and 订正 both fail
  // the same way, and one line under the list is where you are already looking.
  const [rowError, setRowError] = useState("")
  const [queueing, setQueueing] = useState("")
  const [correcting, setCorrecting] = useState("")
  const [correctionID, setCorrectionID] = useState("")
  const [evidenceID, setEvidenceID] = useState("")
  const [correctionAnswer, setCorrectionAnswer] = useState("")
  const [correctionStartedAt, setCorrectionStartedAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")
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
    pendingLocalRecords.current = []
    const currentSubjectRequest = subject === "all" ? {} : { subject }
    const listRequest = {
      ...currentSubjectRequest,
      ...(recordQuery ? { query: recordQuery } : {}),
      ...(recordCause ? { cause: recordCause } : {}),
      ...(recordCorrected ? { corrected: recordCorrected } : {}),
    }
    const currentRecordsRequest = listMistakePage(listRequest)
    // The 六科诊断总览 counts every mistake, not the search result: 搜索 finds a
    // row, it does not redefine what "每科保留自己的错因" is counting. So the
    // whole library is read whenever the visible list is narrowed at all.
    const allRecordsRequest = subject === "all" && !recordQuery
      ? Promise.resolve<{ items: MistakeRecord[]; count: number } | null>(null)
      : listMistakePage({}).catch(() => null)
    currentRecordsRequest
      .then((page) => {
        if (!active) return null
        const loaded = page.items
        setCorrectionID("")
        setEvidenceID("")
        setCorrectionAnswer("")
        setCorrectionStartedAt(null)
        setRecordTotal(page.count)
        setServerRecords(loaded.length)
        const pending = pendingLocalRecords.current
        pendingLocalRecords.current = []
        const merge = (base: MistakeRecord[]) => {
          const loadedIDs = new Set(base.map((record) => record.id))
          return [...pending.filter((record) => !loadedIDs.has(record.id)), ...base]
        }
        setRecords(merge(loaded))
        setDiagnosticRecords(merge(loaded))
        setError("")
        void allRecordsRequest.then((allPage) => {
          if (active && allPage) {
            setDiagnosticRecords((current) => {
              const merged = [...allPage.items, ...current]
              const seen = new Set<string>()
              return merged.filter((record) => {
                if (seen.has(record.id)) return false
                seen.add(record.id)
                return true
              })
            })
          }
        })
        return carryBrowserLogOver().then((carried) => ({ loaded, carried }))
      })
      .then((result) => {
        if (!active || !result || result.carried.length === 0) return
        const visibleCarried = subject === "all"
          ? result.carried
          : result.carried.filter((record) => record.subject.trim().toLowerCase() === subject)
        setRecords((current) => [...visibleCarried, ...current])
        setDiagnosticRecords((current) => [...result.carried, ...current])
      })
      .catch((failure: unknown) => {
        if (active) setError(failureMessage(failure, "读取错题失败"))
      })
    return () => {
      active = false
    }
  }, [subject, recordQuery, recordCause, recordCorrected])

  useEffect(() => {
    let active = true
    listErrorCauses(subject === "all" ? {} : { subject })
      .then((loaded) => {
        if (active) setTaxonomy(taxonomySpecs(loaded))
      })
      .catch(() => {
        if (active) setTaxonomy(MISTAKE_CAUSES)
      })
    return () => {
      active = false
    }
  }, [subject])

  const summary = summarizeMistakes(records, taxonomy)
  const diagnosticSummaries = summarizeMistakeDiagnostics(diagnosticRecords, taxonomy)
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
      pendingLocalRecords.current = [filed, ...pendingLocalRecords.current]
      setRecords((current) => [filed, ...current])
      setDiagnosticRecords((current) => [filed, ...current])
      setQuestion("")
      setError("")
      setFiledNotice(filed.question)
    } catch (failure) {
      setError(failureMessage(failure, "记录错题失败"))
    } finally {
      setBusy(false)
    }
  }

  /**
   * The next page of the log, appended.
   *
   * One request of 50 and the card knows how many there are; searching answers
   * "is it there", this answers "what else is".
   */
  async function loadMoreRecords() {
    if (loadingMoreRecords || recordTotal <= serverRecords) return
    setLoadingMoreRecords(true)
    setError("")
    try {
      const page = await listMistakePage({
        ...(subject === "all" ? {} : { subject }),
        ...(recordQuery ? { query: recordQuery } : {}),
        offset: serverRecords,
      })
      const seen = new Set<string>()
      const fresh = page.items.filter((record) => {
        if (seen.has(record.id)) return false
        seen.add(record.id)
        return true
      })
      const append = (current: MistakeRecord[]) => {
        const known = new Set(current.map((record) => record.id))
        return [...current, ...fresh.filter((record) => !known.has(record.id))]
      }
      // The diagnostics list covers the whole library, and a row that just came
      // off the server belongs in it too.
      setRecords(append)
      setDiagnosticRecords(append)
      setServerRecords((current) => current + fresh.length)
      setRecordTotal(page.count)
    } catch {
      setError("读取更多错题失败，请重试。")
    } finally {
      setLoadingMoreRecords(false)
    }
  }

  /**
   * The whole 错题本, not the page on screen.
   *
   * The list shows the newest fifty and offers a next page; a file that stopped
   * at the same point would look complete and quietly be a fragment.
   */
  async function downloadMistakes() {
    if (exporting) return
    setExporting(true)
    setExportError("")
    try {
      const text = await exportMistakes({
        subject: subject === "all" ? undefined : subject,
        // Same as the list on screen: the search box has already narrowed it.
        query: recordQuery || undefined,
        cause: recordCause || undefined,
        corrected: recordCorrected || undefined,
      })
      saveTextFile(text, `study-os-错题-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8")
    } catch (failure) {
      setExportError(failureMessage(failure, "导出错题失败"))
    } finally {
      setExporting(false)
    }
  }

  async function remove(id: string) {
    try {
      await deleteMistake(id)
      setRecords((current) => current.filter((entry) => entry.id !== id))
      setDiagnosticRecords((current) => current.filter((entry) => entry.id !== id))
      pendingLocalRecords.current = pendingLocalRecords.current.filter((entry) => entry.id !== id)
      // Both counts drop by one with it. A row that was only ever local would
      // make the next offset one short -- re-reading a row that is then deduped
      // -- and the total re-settles on the next page, so neither drifts far.
      setRecordTotal((current) => Math.max(0, current - 1))
      setServerRecords((current) => Math.max(0, current - 1))
      if (correctionID === id) {
        setCorrectionID("")
        setCorrectionAnswer("")
        setCorrectionStartedAt(null)
      }
      if (evidenceID === id) setEvidenceID("")
      setError("")
    } catch (failure) {
      setError(failureMessage(failure, "删除错题失败"))
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
      setDiagnosticRecords((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, knowledgeItemId } : entry)),
      )
      setRowError("")
    } catch (failure) {
      setRowError(failureMessage(failure, "排进复习失败"))
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
  function openCorrection(item: MistakeRecord) {
    if (correcting) return
    setCorrectionID(item.id)
    setCorrectionAnswer("")
    setCorrectionStartedAt(Date.now())
    setRowError("")
  }

  function cancelCorrection() {
    if (correcting) return
    setCorrectionID("")
    setCorrectionAnswer("")
    setCorrectionStartedAt(null)
    setRowError("")
  }

  async function correct(item: MistakeRecord) {
    if (correcting || correctionID !== item.id) return
    const answer = correctionAnswer.trim()
    if (!answer) {
      setRowError("订正答案不能为空")
      return
    }
    const startedAt = correctionStartedAt ?? Date.now()
    const elapsedMs = Math.max(0, Date.now() - startedAt)
    setCorrecting(item.id)
    try {
      const fixed = await correctMistake(item.id, { answer, elapsedMs })
      setRecords((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, corrected: fixed.corrected, correction: fixed.correction }
            : entry,
        ),
      )
      setDiagnosticRecords((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, corrected: fixed.corrected, correction: fixed.correction }
            : entry,
        ),
      )
      setCorrectionID("")
      setCorrectionAnswer("")
      setCorrectionStartedAt(null)
      setRowError("")
    } catch (failure) {
      setRowError(failureMessage(failure, "订正失败"))
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

      <SubjectPrescriptionPanel subject={subject} onSelectSubject={setSubject} />

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>记一笔</CardTitle>
          <p className="text-sm text-muted-foreground">写下是哪道题，然后选一个错因，就存下了。</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            aria-label="错题"
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value)
              setFiledNotice("")
            }}
            placeholder="哪道题？一句话就够"
          />
          <div className="flex flex-wrap gap-2">
            {taxonomy.map((spec) => (
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
          {filedNotice ? (
            <p role="status" className="text-sm text-muted-foreground">
              已记下「{filedNotice}」，在下面「记录」里订正或排进复习。
            </p>
          ) : null}
        </CardContent>
      </Card>

      {subject === "all" ? (
        <Card>
          <CardContent className="pt-4">
            <SubjectDiagnosticSummary
              summaries={diagnosticSummaries}
              activeSubject={subject}
              onSelectSubject={setSubject}
            />
          </CardContent>
        </Card>
      ) : null}

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
            {/* 订正进度 as its own row: the badge above counts, this one shows how far
                through the log that is. Kept separate from the badge so the number a
                test (and a reader) looks for does not change wording. */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground" data-correction-progress="true">
              <span className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-muted sm:w-48">
                <span
                  className="block h-full bg-emerald-500/70"
                  style={{ width: `${Math.round((summary.corrected / summary.total) * 100)}%` }}
                />
              </span>
              <span className="tabular-nums">订正进度 {summary.corrected}/{summary.total}</span>
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
                  {causeActionFor(subject, spec.cause, taxonomy)}
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
        <CardHeader className="gap-2">
          <CardTitle>记录</CardTitle>
          {/* The list is one page of the newest mistakes, so an older one is not
              hard to find here -- it is not in the list at all. */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="搜索错题内容"
              value={recordDraft}
              onChange={(event) => setRecordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                setRecordQuery(recordDraft.trim())
              }}
              placeholder="搜题干里的词"
              className="h-9 max-w-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="搜索错题"
              disabled={!recordDraft.trim() || recordDraft.trim() === recordQuery}
              onClick={() => setRecordQuery(recordDraft.trim())}
            >
              搜索
            </Button>
            {/* By 错因, not just by words: the taxonomy is the point of the log, and
                "show me every method mistake" is how a reader picks what to drill.
                The server narrows it, so the total narrows with the list. */}
            <Select
              ariaLabel="按错因筛选"
              value={recordCause}
              onValueChange={setRecordCause}
              options={[
                { value: "", label: "全部错因" },
                ...taxonomy.map((spec) => ({ value: spec.cause, label: spec.label })),
              ]}
            />
            {/* 订正 state, as a filter rather than only a number: "what is still open"
                is the list worth reading before a test. */}
            {(["", "no", "yes"] as const).map((value) => (
              <button
                key={value || "all"}
                type="button"
                data-corrected-filter={value || "all"}
                aria-pressed={recordCorrected === value}
                onClick={() => {
                  setRecordCorrected(value)
                  // In the link as well as in state: the dashboard sends a reader here
                  // with ?corrected=no, and a filter that only lives in memory cannot
                  // survive that trip.
                  const next = new URLSearchParams(searchParams)
                  if (value) next.set("corrected", value)
                  else next.delete("corrected")
                  setSearchParams(next, { replace: true })
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  recordCorrected === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                {/* Wording note: the chips are named 「未订正」/「订正过」 rather than 「已订正」,
                  because the rows already say 「已订正」 for one mistake -- two different
                  things wearing the same words is how a page starts lying. */}
                {value === "" ? "全部" : value === "no" ? "未订正" : "订正过"}
              </button>
            ))}
            {recordCause ? (
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                只显示「{taxonomy.find((spec) => spec.cause === recordCause)?.label ?? recordCause}」的错题
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => setRecordCause("")}
                >
                  清除
                </button>
              </span>
            ) : null}
            {recordQuery ? (
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                只显示题干提到「{recordQuery}」的错题
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => {
                    setRecordDraft("")
                    setRecordQuery("")
                  }}
                >
                  清除
                </button>
              </span>
            ) : null}
            {/* The list is one page of the newest mistakes; the file is all of
                them, for the reading a page cannot do (print it, hand it to
                someone, sort it in a spreadsheet by 错因). Left out of the Pages
                build, which has no local database to export from -- a button
                that can only fail is worse than no button. */}
            {isStaticDemo() ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto shrink-0"
                disabled={exporting}
                onClick={() => void downloadMistakes()}
              >
                <Download data-icon="inline-start" />
                {exporting ? "导出中…" : "导出 CSV"}
              </Button>
            )}
            {exportError ? (
              <p role="alert" className="w-full text-sm text-destructive">
                {exportError}
              </p>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {/* A filtered miss is not an empty log: saying "还没有记录" while a
                  cause is selected reads as "you have never filed a mistake". */}
              {recordQuery && recordCause
                ? `没有「${causeSpecFor(recordCause, taxonomy).label}」且提到「${recordQuery}」的错题。`
                : recordCause
                  ? `没有「${causeSpecFor(recordCause, taxonomy).label}」的错题。`
                  : recordQuery
                    ? `没有错题提到「${recordQuery}」。`
                    : recordCorrected === "no"
                      ? "没有还没订正的错题 —— 这一本已经清干净了。"
                      : recordCorrected === "yes"
                        ? "还没有订正过的错题。"
                        : "还没有记录。做错一题就来记一笔，比考前翻整本书管用。"}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {records.map((item) => {
                const spec = causeSpecFor(item.cause, taxonomy)
                const evidenceTool = subjectEvidenceToolFor(item)
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/25 px-3 py-2"
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
                        disabled={Boolean(correcting) || Boolean(correctionID)}
                        onClick={() => openCorrection(item)}
                      >
                        <CheckCheck aria-hidden="true" />
                        订正
                      </Button>
                    )}
                    {evidenceTool ? (
                      <Button
                        type="button"
                        variant={evidenceID === item.id ? "secondary" : "outline"}
                        size="sm"
                        className="shrink-0"
                        onClick={() => setEvidenceID((open) => (open === item.id ? "" : item.id))}
                      >
                        {evidenceID === item.id ? "收起诊断" : item.evidence ? "继续诊断" : "开始诊断"}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="删除"
                      onClick={() => void remove(item.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                    <MistakeCauseEditor
                      record={item}
                      onSaved={(saved, cause) => {
                        const update = (entry: MistakeRecord) =>
                          entry.id === item.id ? { ...entry, cause: saved.cause } : entry
                        setRecords((current) => current.map(update))
                        setDiagnosticRecords((current) => current.map(update))
                        setTaxonomy((current) => mergeMistakeCauses([
                          ...current,
                          {
                            cause: cause.id,
                            label: cause.label,
                            reviewFixes: cause.reviewFixes,
                            action: cause.action,
                          },
                        ]))
                      }}
                    />
                    {item.correction ? (
                      <div className="w-full text-xs text-emerald-600 dark:text-emerald-400">
                        答案：{item.correction.answer} · 用时：{item.correction.elapsedMs} ms
                      </div>
                    ) : null}
                    {evidenceID === item.id && evidenceTool ? (
                      <div className="w-full border-t pt-2">
                        <SubjectEvidenceEditor
                          key={item.id}
                          record={item}
                          onSaved={(saved) => {
                            setRecords((current) =>
                              current.map((entry) =>
                                entry.id === item.id ? { ...entry, evidence: saved.evidence } : entry,
                              ),
                            )
                            setDiagnosticRecords((current) =>
                              current.map((entry) =>
                                entry.id === item.id ? { ...entry, evidence: saved.evidence } : entry,
                              ),
                            )
                          }}
                        />
                      </div>
                    ) : null}
                    {correctionID === item.id ? (
                      <form
                        className="flex w-full flex-wrap items-end gap-2 border-t pt-2"
                        onSubmit={(event) => {
                          event.preventDefault()
                          void correct(item)
                        }}
                      >
                        <div className="min-w-48 flex-1">
                          <label htmlFor={`correction-answer-${item.id}`} className="mb-1 block text-xs text-muted-foreground">
                            订正答案
                          </label>
                          <Input
                            id={`correction-answer-${item.id}`}
                            aria-label="订正答案"
                            autoFocus
                            value={correctionAnswer}
                            onChange={(event) => setCorrectionAnswer(event.target.value)}
                            placeholder="写下你确认后的答案"
                            disabled={correcting === item.id}
                          />
                        </div>
                        <Button type="submit" size="sm" disabled={correcting === item.id || !correctionAnswer.trim()}>
                          {correcting === item.id ? "保存中…" : "提交订正"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" disabled={correcting === item.id} onClick={cancelCorrection}>
                          取消订正
                        </Button>
                      </form>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {recordTotal > serverRecords ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              disabled={loadingMoreRecords}
              onClick={() => void loadMoreRecords()}
            >
              {loadingMoreRecords ? "正在读取…" : `加载更多（还有 ${recordTotal - serverRecords} 条）`}
            </Button>
          ) : null}
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
