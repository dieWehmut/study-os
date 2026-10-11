import { useEffect, useState } from "react"
import { ArrowRight, BrainCircuit, CalendarCheck2, CloudOff, Flame, LibraryBig, MessagesSquare, ScanText, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"

import { getDashboard, seedDemo } from "@/api/dashboard"
import { dumpThought } from "@/api/chat"
import { listKnowledge } from "@/api/knowledge"
import { listMistakePage } from "@/api/mistakes"
import type { DashboardData } from "@/api/types"
import { buttonVariants, Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { itemTypeLabel, providerLabel } from "@/lib/labels"
import { MISTAKE_CAUSES, causeSpecFor, type MistakeRecord } from "@/lib/mistakes"
import { buildStuckQuestion, putAskDraft } from "@/lib/ask-draft"
import { readShelf, restoreDocument } from "@/lib/reading-library"
import {
  readReadingSession,
  stuckSections,
  summarizeReadingSession,
  writeReadingSession,
} from "@/lib/reading-session"
import { failureMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"
import { SubjectBadge } from "@/features/subjects/SubjectBadge"
import { SubjectPicker } from "@/features/subjects/SubjectPicker"
import { ReviewForecast } from "@/features/memory/ReviewForecast"
import { useSubjectStore } from "@/store/useSubjectStore"

const emptyDashboard: DashboardData = {
  knowledge_count: 0,
  prompt_count: 0,
  due_count: 0,
  attempt_count: 0,
  reviewed_today: 0,
  current_streak: 0,
  provider: "mock",
  offline: true,
  subjects_due: {},
  recent_items: [],
}

export default function Home() {
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState("")
  const [dumpText, setDumpText] = useState("")
  const [dumping, setDumping] = useState(false)
  const [dumpNotice, setDumpNotice] = useState("")
  // A filed thought is the clearest case of "in the library, not in the queue":
  // 暂存 files it and stops. The notice points at the filter that shows those.
  const [dumpFiled, setDumpFiled] = useState(false)
  // 还没排复习的知识点, from the library rather than from the dashboard.
  const [unscheduled, setUnscheduled] = useState<number | null>(null)
  // The newest mistakes, so the dashboard shows the other half of the work: 最近加入
  // lists what was learned, and this lists what did not stick yet.
  const [recentMistakes, setRecentMistakes] = useState<MistakeRecord[]>([])
  // 还没订正完的错题条数, for the same 接下来 list the queue lives in.
  const [uncorrected, setUncorrected] = useState<number | null>(null)
  // Read and summarized once, on the way in. Nothing on this page edits the
  // reading session, so recomputing it per render would only re-chunk the same
  // document to reach the same answer.
  //
  // The one still in the box wins over the shelf: an open document is one you
  // are in the middle of, a shelved one is one you already decided to walk
  // away from. But the shelf has to be looked at, because the box holds a
  // single document -- without this, 收起这篇 made reading vanish from the
  // dashboard entirely, as though you had never opened anything.
  const [resumable] = useState(() => {
    const open = readReadingSession()
    if (open.markdown.trim() !== "") return { session: open, shelvedId: "" }
    const [newest] = readShelf()
    return newest ? { session: newest, shelvedId: newest.id } : null
  })
  const [resume] = useState(() => (resumable ? summarizeReadingSession(resumable.session) : null))
  const [stuck] = useState(() => (resumable ? stuckSections(resumable.session) : []))

  const subjectFilter = subject === "all" ? undefined : subject

  async function refreshDashboard() {
    setLoading(true)
    setError("")
    try {
      setDashboard(await getDashboard(subjectFilter))
    } catch (reason) {
      setError(failureMessage(reason, "无法读取学习进度"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    getDashboard(subject === "all" ? undefined : subject)
      .then((value) => {
        if (active) setDashboard(value)
      })
      .catch((reason) => {
        if (active) setError(failureMessage(reason, "无法读取学习进度"))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    // 还没排复习的知识点: the dashboard counts the queue, and this is the other half
    // of "what should I do next" -- filed items that will never come back on their
    // own. One item is enough to know there are some.
    listKnowledge({ scheduled: "no", limit: 1, ...(subject === "all" ? {} : { subject }) })
      .then((page) => {
        if (active) setUnscheduled(page.count)
      })
      .catch(() => {
        // A number this page can live without; the queue row still stands.
      })
    listMistakePage({ limit: 3, ...(subject === "all" ? {} : { subject }) })
      .then((page) => {
        if (active) setRecentMistakes(page.items)
      })
      .catch(() => {
        // The card simply does not render; nothing else on the page depends on it.
      })
    // How many are still open. A separate ask, because the count of 还没订正 is not
    // the count of mistakes -- that is the whole point of the row it feeds.
    listMistakePage({ corrected: "no", limit: 1, ...(subject === "all" ? {} : { subject }) })
      .then((page) => {
        if (active) setUncorrected(page.count)
      })
      .catch(() => {
        // No row rather than a wrong number.
      })
    return () => {
      active = false
    }
  }, [subject])

  async function loadDemo() {
    setSeeding(true)
    setError("")
    try {
      await seedDemo()
      await refreshDashboard()
    } catch {
      setError("英语示例没有载入，请重试。")
    } finally {
      setSeeding(false)
    }
  }

  /**
   * Make sure 阅读 opens on the document this card is about.
   *
   * A no-op for the one already in the box. For a shelved one it is the same
   * swap 打开 performs over there, just reached from here -- without it the
   * link lands you on an empty page and you have to find the document on the
   * shelf yourself, which is the trip the card exists to save.
   */
  function openResumable() {
    if (!resumable?.shelvedId) return
    const restored = restoreDocument(resumable.shelvedId)
    if (restored) writeReadingSession(restored)
  }

  async function saveDump() {
    const text = dumpText.trim()
    if (!text || dumping) return
    setDumping(true)
    setDumpNotice("")
    setDumpFiled(false)
    try {
      await dumpThought(text)
      setDumpText("")
      setDumpNotice("已暂存到知识库，稍后可以整理。")
      setDumpFiled(true)
    } catch {
      setDumpNotice("暂存失败，请重试。")
    } finally {
      setDumping(false)
    }
  }

  return (
    <section className="grid gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">只检测值得记忆的内容；每次作答都会留下他评、反馈和下一次复习安排。</p>
      </div>

      <Card>
        <CardHeader className="gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>选择学科</CardTitle>
            <button
              type="button"
              aria-pressed={subject === "all"}
              onClick={() => setSubject("all")}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                subject === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              全部
            </button>
          </div>
          <p className="text-sm text-muted-foreground">不同学科有各自的记忆题型与整理方式，选一个开始。</p>
        </CardHeader>
        <CardContent>
          <SubjectPicker subject={subject} onSelect={setSubject} dueCounts={dashboard.subjects_due} />
        </CardContent>
      </Card>

      {/* What to do next, in the order the day goes: clear the queue, then deal with
          anything filed that will never come back on its own. Both rows are links,
          because a dashboard that only reports is one nobody acts on. */}
      <Card data-home-next-step="true">
        <CardHeader className="gap-1.5">
          <CardTitle>接下来</CardTitle>
          <p className="text-sm text-muted-foreground">
            {dashboard.due_count > 0 || (unscheduled ?? 0) > 0
              ? "按下面的顺序做，今天就算完成了。"
              : loading
                ? "正在看今天还剩什么…"
                : "今天没有待办：队列清空了，库里也没有落单的知识点。"}
          </p>
        </CardHeader>
        <CardContent className="grid gap-2">
          {dashboard.due_count > 0 ? (
            <Link
              to="/memory"
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2 text-sm transition-colors hover:bg-muted/50"
            >
              <span>
                先复习 <strong>{dashboard.due_count}</strong> 个到期知识点
                <span className="ml-2 text-xs text-muted-foreground">今天该过的就这些</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-primary" />
            </Link>
          ) : null}
          {(unscheduled ?? 0) > 0 ? (
            <Link
              to="/knowledge?scheduled=no"
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2 text-sm transition-colors hover:bg-muted/50"
            >
              <span>
                还有 <strong>{unscheduled}</strong> 个知识点没排复习
                <span className="ml-2 text-xs text-muted-foreground">不排进来就永远不会被问</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-primary" />
            </Link>
          ) : null}
          {!loading && dashboard.due_count === 0 && unscheduled === null ? (
            <p className="text-xs text-muted-foreground">读不到库里的知识点数量，队列那一行仍然准。</p>
          ) : null}
          {/* The third thing to do, and the one that is easiest to leave: a mistake
              nobody goes back to is a mistake that will happen again. */}
          {(uncorrected ?? 0) > 0 ? (
            <Link
              to="/practice?corrected=no"
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2 text-sm transition-colors hover:bg-muted/50"
            >
              <span>
                还有 <strong>{uncorrected}</strong> 条错题没订正
                <span className="ml-2 text-xs text-muted-foreground">不回头看一眼，下次还会错同一处</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-primary" />
            </Link>
          ) : null}
        </CardContent>
      </Card>

      {/* The same panel the memory page ends with, on the page you start from: one
          number (待复习) cannot show a pile-up, and the pile-up is the day people
          quit. It renders nothing while loading, on failure, or with no schedule. */}
      <ReviewForecast />

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>先把念头扔进来</CardTitle>
          <p className="text-sm text-muted-foreground">不用分类、不用写完整，半句话也可以，先存下再说。</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <textarea
            aria-label="脑暴收集箱"
            value={dumpText}
            onChange={(event) => setDumpText(event.target.value)}
            placeholder="例如：等下查一下动能定理的适用条件…"
            className="min-h-20 resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-3">
            <Button disabled={!dumpText.trim() || dumping} onClick={() => void saveDump()}>
              {dumping ? "暂存中…" : "暂存"}
            </Button>
            {dumpNotice ? (
              <p aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {dumpNotice}
                {/* 「稍后可以整理」is a promise with no address. A filed thought
                    carries no cards, which is exactly what this filter shows. */}
                {dumpFiled ? (
                  <Link className="underline underline-offset-4" to="/knowledge?scheduled=no">
                    去整理
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void refreshDashboard()}>重试</Button>
        </div>
      ) : null}

      {/* Ahead of 今天要巩固 for the same reason 阅读 sits above 记忆 in the
          sidebar: this is where you meet material you do not have yet, and an
          unfinished document is a sharper claim on the next ten minutes than a
          queue that will still be there tomorrow. Absent entirely when there is
          nothing to go back to -- a card offering to resume nothing is worse
          than no card. */}
      {resume ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="gap-1.5">
            <CardTitle className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
              <ScanText aria-hidden="true" className="size-4 text-primary" />
              接着读
            </CardTitle>
            <p className="font-heading text-xl font-semibold tracking-tight">{resume.title}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.round((resume.read / resume.total) * 100)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link className={buttonVariants({ size: "sm" })} to="/reading" onClick={openResumable}>
                继续读<ArrowRight data-icon="inline-end" />
              </Link>
              <span className="text-sm text-muted-foreground">
                已读 {resume.read} / {resume.total} · 还剩 {resume.remaining} 节
              </span>
            </div>
            {/* "还剩 1 节" is a chore; what did not land is the reason to come
                back at all, and it is the only thing a preview pass leaves
                behind. Silent at zero: nothing being in the way is the
                starting state, not a result worth reporting. */}
            {stuck.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-primary/15 pt-3">
                <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  {stuck.length} 节没看懂
                </span>
                <span className="truncate text-sm text-muted-foreground">
                  {stuck.map((chunk) => chunk.title).join(" · ")}
                </span>
                <Link
                  className={buttonVariants({ variant: "outline", size: "sm", className: "ml-auto" })}
                  to="/chat"
                  onClick={() => putAskDraft(buildStuckQuestion(stuck))}
                >
                  <MessagesSquare data-icon="inline-start" />去问
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* The stats column next to it is three cards tall, so this one is
            stretched to that height whatever it holds. Centred, the space reads
            as the hero it is; top-aligned it read as a card whose content had
            failed to load. */}
        <Card className="relative justify-center overflow-hidden lg:col-span-2">
          <CardHeader className="gap-3">
            <CardTitle className="text-sm font-normal text-muted-foreground">今天要巩固</CardTitle>
            <p className="font-heading text-5xl font-semibold tracking-tight sm:text-6xl">
              {loading ? "—" : `${dashboard.due_count} 个待复习`}
            </p>
            <p className="text-sm text-muted-foreground">
              今日已完成 {dashboard.reviewed_today} 次检测 · 连续学习 {dashboard.current_streak} 天
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Link className={buttonVariants({ size: "lg" })} to="/memory">
              开始复习<ArrowRight data-icon="inline-end" />
            </Link>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {dashboard.offline ? <CloudOff aria-hidden="true" className="size-4 text-primary" /> : <Sparkles aria-hidden="true" className="size-4 text-primary" />}
              {providerLabel(dashboard.provider)} · {dashboard.offline ? "离线可用" : "在线"}
            </span>
          </CardContent>
        </Card>

        <div className="grid content-stretch gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm font-normal text-muted-foreground">知识点</CardTitle>
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><LibraryBig aria-hidden="true" className="size-4" /></span>
            </CardHeader>
            <CardContent><p className="text-3xl font-semibold">{loading ? "—" : `${dashboard.knowledge_count} 个知识点`}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm font-normal text-muted-foreground">今日检测</CardTitle>
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><CalendarCheck2 aria-hidden="true" className="size-4" /></span>
            </CardHeader>
            <CardContent><p className="text-3xl font-semibold">{loading ? "—" : `${dashboard.reviewed_today} 次`}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm font-normal text-muted-foreground">连续学习</CardTitle>
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Flame aria-hidden="true" className="size-4" /></span>
            </CardHeader>
            <CardContent><p className="text-3xl font-semibold">{loading ? "—" : `${dashboard.current_streak} 天`}</p></CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { to: "/knowledge", label: "知识库", description: "浏览与整理知识点", icon: LibraryBig },
          // Same order as the sidebar: reading comes before reviewing, because
          // that is the order you actually meet the material in.
          { to: "/reading", label: "阅读", description: "先看结构，再读正文", icon: ScanText },
          { to: "/memory", label: "记忆", description: "按计划完成复习", icon: BrainCircuit },
          { to: "/chat", label: "答疑", description: "随时问 AI，异步回答", icon: MessagesSquare },
        ].map(({ to, label, description, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-auto flex-col items-start gap-1.5 p-4",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Icon aria-hidden="true" className="size-4 text-primary" />
              {label}
            </span>
            <span className="text-xs font-normal text-muted-foreground">{description}</span>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>最近加入</CardTitle>
          <p className="text-sm text-muted-foreground">最新整理的知识点与念头</p>
        </CardHeader>
        <CardContent className="grid gap-2">
          {!dashboard.recent_items || dashboard.recent_items.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              还没有知识点。先去导入资料，或在上方暂存一个念头。
            </p>
          ) : (
            dashboard.recent_items.map((item) => (
              <Link
                key={item.id}
                to="/knowledge"
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <span className="truncate text-sm font-medium">{item.term}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {item.subject ? <SubjectBadge subject={item.subject} /> : null}
                  <span className="text-xs text-muted-foreground">{itemTypeLabel(item.item_type)}</span>
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {/* The other half of the picture. 最近加入 says what was learned; this says what
          has not stuck yet, in the words it was written in. Absent while there are no
          mistakes, so a clean library shows no empty heading. */}
      {recentMistakes.length > 0 ? (
        <Card data-home-mistakes="true">
          <CardHeader className="gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>最近错题</CardTitle>
              <Link to="/practice" className="text-xs text-muted-foreground underline underline-offset-4">
                去练习
              </Link>
            </div>
            <p className="text-sm text-muted-foreground">还没订正完的，趁还记得住先把它们过一遍。</p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {recentMistakes.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/25 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{item.question}</span>
                  <Badge variant="outline">{causeSpecFor(item.cause, MISTAKE_CAUSES).label}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {!loading && dashboard.knowledge_count === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="gap-2">
            <CardTitle>先体验一轮真实记忆闭环</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="text-sm leading-6 text-muted-foreground">加载一个英语词义示例，系统会生成英译中、中译英和语境填空三种检测。</p>
            <Button disabled={seeding} onClick={() => void loadDemo()}>{seeding ? "正在载入…" : "载入英语示例"}</Button>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
