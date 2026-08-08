import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Archive, CircleHelp, Library, MessagesSquare, Network, ScanText, Trash2 } from "lucide-react"

import { dumpThought } from "@/api/chat"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { MindMap } from "@/features/mindmap/MindMap"
import { FocusReader } from "@/features/reading/FocusReader"
import { StructurePreview } from "@/features/reading/StructurePreview"
import { buildStuckQuestion, putAskDraft } from "@/lib/ask-draft"
import { chunkMarkdown } from "@/lib/chunk"
import { markdownToMindMap } from "@/lib/mindmap"
import { forgetDocument, readShelf, restoreDocument, shelveDocument } from "@/lib/reading-library"
import { buildSectionNote } from "@/lib/reading-note"
import {
  emptyReadingSession,
  readReadingSession,
  summarizeReadingSession,
  writeReadingSession,
  type ReadingSession,
} from "@/lib/reading-session"

export default function Reading() {
  const [showMap, setShowMap] = useState(false)
  // The document, the place and the marks travel together, because a mark
  // names a chunk id and chunk ids come from the document's own shape.
  const [session, setSession] = useState<ReadingSession>(readReadingSession)
  // Everything you closed. The box holds one document at a time, so without
  // this the second paste is a deletion.
  const [shelf, setShelf] = useState(readShelf)
  // Sections already sent to the knowledge library. Held here rather than in
  // the session because the durable record is the item on the other end; this
  // only stops a second click filing a duplicate nobody can undo.
  const [keptIds, setKeptIds] = useState<ReadonlySet<string>>(new Set<string>())
  const [keepError, setKeepError] = useState("")
  const { markdown } = session

  const chunks = useMemo(() => chunkMarkdown(markdown), [markdown])
  // The same headings the outline is built from, drawn sideways. No model, and
  // no second paste box to keep in sync with this one.
  const map = useMemo(() => markdownToMindMap(markdown), [markdown])
  const readIds = useMemo(() => new Set(session.readIds), [session.readIds])
  const stuckIds = useMemo(() => new Set(session.stuckIds), [session.stuckIds])
  // A place stored against a longer draft has to land somewhere real in this
  // one, or the reader points at a stop that is not there.
  const index = Math.min(session.index, Math.max(chunks.length - 1, 0))
  // Resolved against this document, not read straight off the session: the
  // marks were made against whatever draft was in the box at the time, and a
  // stale id would list a section nobody can navigate to.
  const stuck = useMemo(
    () => chunks.filter((chunk) => stuckIds.has(chunk.id)),
    [chunks, stuckIds],
  )

  // Each row is what the shelf can say about a document without opening it:
  // its own title, and how far the reading got. Summarized here rather than in
  // the row so a document that yields no stops drops out once, not per field.
  const shelfRows = useMemo(
    () =>
      shelf.flatMap((entry) => {
        const summary = summarizeReadingSession(entry)
        return summary ? [{ id: entry.id, summary }] : []
      }),
    [shelf],
  )

  function save(next: ReadingSession) {
    setSession(next)
    writeReadingSession(next)
  }

  /** Put the open document away, marks and all, and clear the box for the next. */
  function closeDocument() {
    setShelf(shelveDocument(session))
    save(emptyReadingSession)
  }

  /**
   * Swap a shelved document in for the one you are holding.
   *
   * Taken off the shelf before the open one goes on, which matters at the
   * shelf's cap: shelving first would evict the oldest to make room for a slot
   * the restore is about to free anyway.
   */
  function openShelved(id: string) {
    const restored = restoreDocument(id)
    if (!restored) return
    setShelf(shelveDocument(session))
    save(restored)
  }

  function toggleStuck(id: string) {    // No page turn, unlike 读完: this says the stop did not land, and moving
    // you would carry you away from the paragraph you just flagged.
    save({
      ...session,
      index,
      stuckIds: stuckIds.has(id)
        ? session.stuckIds.filter((entry) => entry !== id)
        : [...session.stuckIds, id],
    })
  }

  /**
   * Send a section that landed into the knowledge library.
   *
   * The one way out of 预习 and into 复习. Everything else the page produces is
   * about this document: how far you got, what is still in the way. This is the
   * only thing that outlives it, which is also why it is deliberately not
   * wired to 读完 -- turning a page is not a decision to remember it.
   */
  async function keepSection(id: string) {
    const chunk = chunks.find((item) => item.id === id)
    if (!chunk || keptIds.has(id)) return

    setKeepError("")
    try {
      await dumpThought(buildSectionNote(chunk))
      setKeptIds((kept) => new Set(kept).add(id))
    } catch {
      // Left un-kept on purpose: a control that looks saved when nothing was
      // written is worse than one that failed loudly.
      setKeepError("收进知识库失败，等会儿再试。")
    }
  }

  function toggleRead(id: string) {
    if (readIds.has(id)) {
      // Taking a mark back is a correction, and moving you would carry you away
      // from the stop you came back to fix.
      save({ ...session, index, readIds: session.readIds.filter((entry) => entry !== id) })
      return
    }
    // Marking a stop and then reaching for 下一节 is two actions for one intent.
    save({
      ...session,
      index: Math.min(index + 1, chunks.length - 1),
      readIds: [...session.readIds, id],
    })
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ScanText aria-hidden="true" className="size-4 text-primary" />
        <h1 className="font-heading text-2xl font-semibold tracking-tight">阅读</h1>
      </div>

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>原文</CardTitle>
          <p className="text-sm text-muted-foreground">
            粘贴讲义或笔记。用 <code className="text-xs">#</code> 标题分节效果最好。
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            aria-label="原文"
            value={markdown}
            onChange={(event) => {
              // A new document has a new set of stops; keeping the old position
              // would drop the reader somewhere arbitrary in it, and the old
              // marks would attach to stops nobody has read.
              save({ ...emptyReadingSession, markdown: event.target.value })
            }}
            placeholder={"# 标题\n## 小节\n正文…"}
            className="min-h-40 font-mono text-xs"
          />
          {map.nodes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowMap((open) => !open)}>
                <Network data-icon="inline-start" />{showMap ? "收起导图" : "看导图"}
              </Button>
              <span className="text-xs text-muted-foreground">层级来自标题，没有经过模型改写</span>
            </div>
          ) : null}
          {/* Putting a document away is its own action, not something the box
              does on the next paste: onChange fires per keystroke, and a paste
              that shelves would file a copy for every letter typed. */}
          {markdown.trim() !== "" ? (
            <Button variant="outline" size="sm" className="self-start" onClick={closeDocument}>
              <Archive data-icon="inline-start" />收起这篇，换一份
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Absent while the shelf is empty: a heading over nothing is worse than
          no heading, and until you have closed something there is nothing here
          the page can help you with. */}
      {shelfRows.length > 0 ? (
        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <Library aria-hidden="true" className="size-4 text-primary" />
              收起来的
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {shelfRows.length} 篇 · 点一篇换回来，正在读的这份会收进来。
            </p>
          </CardHeader>
          <CardContent className="grid gap-2">
            {/* Two actions, so two sibling buttons rather than one nested in
                the other -- the border and the hover move up to the row. Both
                are labelled with the title, because "打开" and "扔掉" alone are
                indistinguishable once there is more than one row. */}
            {shelfRows.map(({ id, summary }) => (
              <div
                key={id}
                className="flex items-center gap-1 rounded-lg border border-border bg-muted/25 pr-1.5 transition-colors hover:bg-muted/50"
              >
                <button
                  type="button"
                  aria-label={`打开 ${summary.title}`}
                  onClick={() => openShelved(id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate text-sm font-medium">{summary.title}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {/* What is in the way is the reason to come back, so it goes
                        first and keeps its colour -- 已读 3 / 8 only says how far
                        you got. Silent at zero. */}
                    {summary.stuck > 0 ? (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        {summary.stuck} 节没看懂
                      </span>
                    ) : null}
                    <span>已读 {summary.read} / {summary.total}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`扔掉 ${summary.title}`}
                  onClick={() => setShelf(forgetDocument(id))}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Folded away by default: the outline, the prose and a full map all at
          once is the same wall of information the preview exists to avoid. */}
      {showMap && map.nodes.length > 0 ? (
        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle>{map.title}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {map.nodes.length} 个节点 · 点一个分支可以折叠它，先看整体再展开细节。
            </p>
          </CardHeader>
          <CardContent>
            <MindMap data={map} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,19rem)_1fr]">
        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle>结构</CardTitle>
            <p className="text-sm text-muted-foreground">
              先看这一栏：有几站、多深、多重。
            </p>
          </CardHeader>
          <CardContent>
            <StructurePreview
              markdown={markdown}
              activeId={chunks[index]?.id}
              readIds={readIds}
              stuckIds={stuckIds}
              onSelect={(chunk) =>
                save({ ...session, index: chunks.findIndex((item) => item.id === chunk.id) })
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle>正文</CardTitle>
            <p className="text-sm text-muted-foreground">
              一次只放一节，方向键翻页。看懂的可以收进知识库，之后会安排复习。
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <FocusReader
              chunks={chunks}
              index={index}
              onIndexChange={(next) => save({ ...session, index: next })}
              onToggleRead={toggleRead}
              readIds={readIds}
              onToggleStuck={toggleStuck}
              stuckIds={stuckIds}
              onKeep={(id) => void keepSection(id)}
              keptIds={keptIds}
            />
            {keepError ? (
              <p role="alert" className="text-sm text-destructive">
                {keepError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* The reader shows one stop at a time, so it can say "this one did not
          land" but never "here is everything that did not". That list is the
          whole output of reading for structure first -- it is what you take to
          答疑, or read again slowly, and it is the only artefact of a preview
          pass worth keeping. */}
      {stuck.length > 0 ? (
        <Card className="border-amber-500/35 bg-amber-500/5">
          <CardHeader className="gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <CircleHelp aria-hidden="true" className="size-4 text-amber-600 dark:text-amber-400" />
              卡住的地方
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {stuck.length} 节没看懂 · 点一个跳回去，或者带着这几节去问。
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {stuck.map((chunk) => (
                <Button
                  key={chunk.id}
                  variant="outline"
                  size="sm"
                  aria-label={`卡住：${chunk.title}`}
                  onClick={() =>
                    save({
                      ...session,
                      index: chunks.findIndex((item) => item.id === chunk.id),
                    })
                  }
                >
                  {chunk.title}
                </Button>
              ))}
            </div>
            {/* The whole set goes at once, not one section at a time: what is
                in the way is usually the gap between them, and 答疑 cannot see
                that from a single heading. */}
            <Link
              className={buttonVariants({ size: "sm", className: "self-start" })}
              to="/chat"
              onClick={() => putAskDraft(buildStuckQuestion(stuck))}
            >
              <MessagesSquare data-icon="inline-start" />带这 {stuck.length} 节去问
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
