import ReactMarkdown from "react-markdown"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { useEffect, useMemo, useState } from "react"
import { BookOpenText, CalendarPlus, ChevronLeft, ChevronRight, Waypoints } from "lucide-react"

import { updateKnowledgeTag } from "@/api/chat"
import {
  listRelatedKnowledge,
  saveKnowledgeWiki,
  scheduleKnowledge,
  type RelatedKnowledge,
} from "@/api/knowledge"
import type { KnowledgeItem } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { tagOptionsFor } from "@/lib/insights"
import { itemTypeLabel } from "@/lib/labels"
import { markdownToMindMap } from "@/lib/mindmap"
import { MindMap } from "@/features/mindmap/MindMap"
import { SubjectBadge } from "@/features/subjects/SubjectBadge"
import { renameOutlineLine } from "@/lib/wiki-edit"

interface WikiPanelProps {
  item: KnowledgeItem | null
  /** The item already carries review cards, as of the last list request. */
  scheduled?: boolean
  onUpdated?: (item: KnowledgeItem) => void
  /**
   * Open one of the item's family. Takes an id rather than an item because the
   * sibling routinely sits outside whatever filter the list is under, so the
   * caller has to be able to answer for a word it is not currently showing.
   */
  onSelectRelated?: (id: string) => void
}

// What the last 排进复习 press actually did. "known" is not a failure: the
// backend answers idempotently, and reporting that as a fresh success would
// claim cards were created when none were.
type ScheduleNote = { tone: "ok" | "known" | "error"; text: string }

const scheduleNoteClass: Record<ScheduleNote["tone"], string> = {
  ok: "text-primary",
  known: "text-muted-foreground",
  error: "text-destructive",
}

// What the last 改名 press did. "refused" is the title's fault, not the
// network's: an empty title or one that would restructure the document can
// never be written, and the wiki must not be asked to try.
type RenameNote = { tone: "ok" | "refused" | "error"; text: string }

const renameNoteClass: Record<RenameNote["tone"], string> = {
  ok: "text-primary",
  refused: "text-destructive",
  error: "text-destructive",
}

function chunkMarkdown(markdown: string): string[] {
  const chunks = markdown.split(/(?=^#{1,6} )/m).map((chunk) => chunk.trim()).filter(Boolean)
  return chunks.length > 0 ? chunks : [markdown]
}

// One shared value, so a failed or absent answer is the same object every
// render and the loading effect cannot depend on its identity.
const emptyFamily: RelatedKnowledge = { items: [], groups: [] }

/**
 * What to call the block.
 *
 * The groups themselves say what kind of grouping they are, so the heading
 * follows the data rather than the page's subject chip -- a 化学 point grouped
 * some day by 反应类型 must not be announced as a 词族.
 */
function familyLabel(groups: RelatedKnowledge["groups"]): string {
  return groups.length > 0 && groups.every((group) => group.kind === "word_family")
    ? "词族"
    : "同组知识点"
}

export function WikiPanel({ item, scheduled = false, onUpdated, onSelectRelated }: WikiPanelProps) {
  const [tagOverride, setTagOverride] = useState<string[] | null>(null)
  const [chunkIndex, setChunkIndex] = useState(0)
  const [tagPending, setTagPending] = useState("")
  const [schedulePending, setSchedulePending] = useState(false)
  const [scheduleNote, setScheduleNote] = useState<ScheduleNote | null>(null)
  const [renameNote, setRenameNote] = useState<RenameNote | null>(null)
  const [renamePending, setRenamePending] = useState(false)
  const [family, setFamily] = useState<RelatedKnowledge>(emptyFamily)
  const current: KnowledgeItem | null = item ? { ...item, tags: tagOverride ?? item.tags } : null
  // Keyed on the id, not the item: a tag toggle replaces the item object, and
  // re-asking the server for the same word's family on every tag press would
  // be a request that can only ever return what is already on screen.
  const itemID = item?.id
  // Only a confirmed write closes the control. A failed press leaves it open,
  // because a button that looks done when nothing was written is worse than
  // one that failed loudly. The prop is what the list knew before this panel
  // opened; the note is what this panel did since.
  const inQueue = scheduled || scheduleNote?.tone === "ok" || scheduleNote?.tone === "known"

  const chunks = current?.detailed_markdown ? chunkMarkdown(current.detailed_markdown) : []

  // The same markdown, read as a shape instead of as prose (0807:75 -- a
  // markdown wiki needs no model to become a map, only a parser). Memoised
  // because every tag press and every family response rebuilds this panel, and
  // re-parsing the whole wiki each time buys nothing: the source has not moved.
  //
  // Read off `item` rather than `current`, which differs from it only by the
  // tag overlay: depending on that freshly-spread object would re-parse the
  // whole wiki on every tag press, which is exactly what the memo is for.
  //
  // Titled with the term rather than the document's own heading: a wiki entry
  // usually opens at `##`, having been written *about* the word, so its map
  // would otherwise root at 用法 or 例句 and never name what it is a map of.
  const markdown = item?.detailed_markdown ?? ""
  const term = item?.term ?? ""
  const map = useMemo(
    () => (markdown ? markdownToMindMap(markdown, { title: term }) : null),
    [markdown, term],
  )

  // The grouping has been written by the English pipeline since it existed and
  // was readable only by a group id nobody was ever shown. A failure stays
  // silent: the family is context, and an error line about it would sit above
  // the definition you actually opened the panel for.
  useEffect(() => {
    if (!itemID) return
    let active = true
    void listRelatedKnowledge(itemID)
      .then((related) => {
        if (active) setFamily(related)
      })
      .catch(() => {
        // The word itself is the point; its family is a bonus.
      })
    return () => {
      active = false
    }
  }, [itemID])

  async function toggleTag(tag: string) {
    if (!current || tagPending) return
    const has = current.tags?.includes(tag) ?? false
    setTagPending(tag)
    try {
      const updated = await updateKnowledgeTag(current.id, tag, has)
      setTagOverride(updated.tags ?? null)
      onUpdated?.(updated)
    } finally {
      setTagPending("")
    }
  }

  // 收进知识库 and the home page's 暂存 box both file an item and stop there.
  // The due query joins review_states, so an item carrying no cards can never
  // surface in 复习 -- this is the one control that turns a filed point into
  // something the schedule will ever ask you about again.
  async function sendToReview() {
    if (!current || schedulePending || inQueue) return
    setSchedulePending(true)
    setScheduleNote(null)
    try {
      const result = await scheduleKnowledge(current.id)
      setScheduleNote(
        result.status === "already_scheduled"
          ? { tone: "known", text: "已经在复习计划里" }
          : { tone: "ok", text: `已排进复习 · ${result.prompt_count} 张卡` },
      )
    } catch {
      setScheduleNote({ tone: "error", text: "排进复习失败，请重试" })
    } finally {
      setSchedulePending(false)
    }
  }

  /**
   * 0807:13 「可轻易编辑」 -- the edit the map itself cannot keep.
   *
   * The map is re-derived from `detailed_markdown` on every draw, so a renamed
   * node only exists once that markdown has changed. The rewrite is done a line
   * at a time (`renameOutlineLine`) rather than by regenerating the document
   * from the tree, because the parser does not model blank lines, code fences
   * or tables and a regenerated wiki would quietly launder all three.
   */
  async function renameNode(line: number, title: string) {
    if (!item || renamePending) return
    const next = renameOutlineLine(markdown, line, title)
    if (next === null) {
      // Refused before any request. The reasons are all properties of the title
      // itself -- blank, multi-line, or a leading `#` that would re-level every
      // section after it -- so the server would only refuse it again.
      setRenameNote({ tone: "refused", text: "这个标题存不下来，换一个" })
      return
    }
    // Retyping a title as itself is not an edit. Saving anyway would report
    // success for a write that changed nothing.
    if (next === markdown) {
      setRenameNote(null)
      return
    }
    setRenamePending(true)
    setRenameNote(null)
    try {
      const saved = await saveKnowledgeWiki(item.id, next)
      // The panel keeps no copy of the markdown, so this is what makes the new
      // title visible: the caller replaces the item and the map is re-derived.
      onUpdated?.(saved)
      setRenameNote({ tone: "ok", text: `已改名为「${title.trim()}」` })
    } catch {
      // The map redraws from the item it was handed, so the old title is still
      // on screen. Silence here would read as a rename that quietly did nothing.
      setRenameNote({ tone: "error", text: "改名失败，请重试" })
    } finally {
      setRenamePending(false)
    }
  }

  if (!item) {
    return (
      <Card className="grid min-h-64 place-items-center border-dashed">
        <CardContent className="grid justify-items-center gap-2 text-center text-sm text-muted-foreground">
          <BookOpenText aria-hidden="true" className="size-6 text-primary/50" />
          <span>选择一个知识点查看百科</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card key={item.id} className="min-w-0">
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{itemTypeLabel(item.item_type)}</Badge>
          {item.subject ? <SubjectBadge subject={item.subject} /> : null}
          {item.level ? <Badge variant="outline">{item.level}</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The item's own subject decides, not the page's chip: under
              全部学科 a 化学 point would otherwise be offered 二级结论 instead
              of the 考点 / 题型 / 易错点 it is actually sorted by. Tags it
              already carries are appended so none becomes unremovable. */}
          {tagOptionsFor(item.subject ?? "", current?.tags ?? []).map((tag) => {
            const active = current?.tags?.includes(tag) ?? false
            return (
              <Button
                key={tag}
                type="button"
                size="xs"
                variant={active ? "default" : "outline"}
                disabled={Boolean(tagPending)}
                onClick={() => void toggleTag(tag)}
              >
                {active ? `✓ ${tag}` : tag}
              </Button>
            )
          })}
          <Button
            type="button"
            size="xs"
            variant={inQueue ? "secondary" : "default"}
            className="ml-auto"
            disabled={schedulePending || inQueue}
            onClick={() => void sendToReview()}
          >
            <CalendarPlus data-icon="inline-start" />
            {inQueue ? "已排进复习" : "排进复习"}
          </Button>
        </div>
        {scheduleNote ? (
          <p className={`text-xs ${scheduleNoteClass[scheduleNote.tone]}`}>{scheduleNote.text}</p>
        ) : null}
        <h2 className="font-heading text-3xl font-semibold tracking-tight">{item.term}</h2>
        {item.part_of_speech || item.pronunciation ? (
          <CardDescription>{[item.part_of_speech, item.pronunciation].filter(Boolean).join(" · ")}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="pt-4">
        <Tabs defaultValue="concise">
          <TabsList aria-label="Wiki视图">
            <TabsTrigger value="concise">简明</TabsTrigger>
            <TabsTrigger value="detail">详细百科</TabsTrigger>
            <TabsTrigger value="map">导图</TabsTrigger>
          </TabsList>
          <TabsContent value="concise" className="grid gap-5 pt-5">
            <section className="grid gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">简明定义</h2>
              <p className="text-lg leading-8">{item.concise_definition}</p>
            </section>
            {item.example ? (
              <section className="grid gap-2 rounded-lg border bg-muted/25 p-4">
                <h2 className="text-sm font-medium text-muted-foreground">例句</h2>
                <p className="leading-7">{item.example}</p>
              </section>
            ) : null}
          </TabsContent>
          <TabsContent value="detail" className="pt-5">
            {chunks.length > 0 ? (
              <div className="grid gap-3">
                {chunks.length > 1 ? (
                  <div className="flex items-center justify-between gap-2">
                    <Button size="xs" variant="outline" disabled={chunkIndex === 0} onClick={() => setChunkIndex((value) => Math.max(0, value - 1))}>
                      <ChevronLeft data-icon="inline-start" />上一块
                    </Button>
                    <span className="text-xs text-muted-foreground">第 {chunkIndex + 1} / {chunks.length} 块</span>
                    <Button size="xs" variant="outline" disabled={chunkIndex >= chunks.length - 1} onClick={() => setChunkIndex((value) => Math.min(chunks.length - 1, value + 1))}>
                      下一块<ChevronRight data-icon="inline-end" />
                    </Button>
                  </div>
                ) : null}
                <div className="rounded-lg border border-border bg-card p-3 leading-7 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:font-heading [&_h1]:text-2xl [&_h2]:font-heading [&_h2]:text-xl [&_h3]:font-heading [&_h3]:text-lg [&_li]:ml-5 [&_li]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3">
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    urlTransform={(url) => (/^(https?:|mailto:)/i.test(url) ? url : "")}
                  >
                    {chunks[chunkIndex]}
                  </ReactMarkdown>
                </div>
              </div>
            ) : <p className="text-sm text-muted-foreground">这个知识点还没有详细百科。</p>}
          </TabsContent>
          <TabsContent value="map" className="pt-5">
            {/* A one-section wiki has no shape worth drawing: a root with a
                single branch tells you nothing the heading above it did not,
                so the reader is sent to the prose instead of being handed a
                picture of one line. `markdownToMindMap` already answers this
                by returning no nodes for a document with no sections. */}
            {map && map.nodes.length > 0 ? (
              <div className="grid gap-2">
                {/* `fit`: this panel is a narrow column, and an unscaled map
                    would put most of a real wiki's branches past its right
                    edge. */}
                <MindMap data={map} fit onRename={(line, title) => void renameNode(line, title)} />
                {renameNote ? (
                  <p className={`text-xs ${renameNoteClass[renameNote.tone]}`}>{renameNote.text}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  点节点折叠分支，点 ≡ 看该节原文，点 ▣ 看该节配图，点 ✎ 改这一节的标题。
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {chunks.length > 0 ? "这篇百科只有一段，没有可拆的层级。" : "这个知识点还没有详细百科。"}
              </p>
            )}
          </TabsContent>
        </Tabs>
        {/* Nothing at all for the majority of items, which belong to no group:
            an empty heading on every one of them would be a standing reminder
            of something that is not missing. */}
        {family.items.length > 0 ? (
          <section aria-label={familyLabel(family.groups)} className="mt-5 grid gap-3 rounded-lg border bg-muted/25 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Waypoints aria-hidden="true" className="size-4 text-primary" />
              <h2 className="text-sm font-medium">{familyLabel(family.groups)}</h2>
              {family.groups.map((group) => (
                <Badge key={group.id} variant="outline">{group.name}</Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {family.items.map((sibling) => (
                <Button
                  key={sibling.id}
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => onSelectRelated?.(sibling.id)}
                >
                  {sibling.term}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">一起过一遍，比单独背这一个划算。</p>
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}
