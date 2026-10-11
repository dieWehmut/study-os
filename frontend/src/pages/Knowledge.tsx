import { useCallback, useEffect, useState } from "react"
import { Download, GitCompareArrows, LibraryBig, Link2, RotateCcw, Search } from "lucide-react"
import { useLocation, useSearchParams } from "react-router-dom"

import { compareKnowledge } from "@/api/chat"
import { exportKnowledge, getKnowledge, listGroups, listKnowledge, type KnowledgeGroup } from "@/api/knowledge"
import type { CompareOutput, KnowledgeItem } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { appUrl, copyUrl } from "@/lib/link"
import { cn } from "@/lib/utils"
import { SubjectChips } from "@/features/subjects/SubjectChips"
import { KnowledgeList } from "@/features/knowledge/KnowledgeList"
import { WikiPanel } from "@/features/knowledge/WikiPanel"
import { insightTagsFor } from "@/lib/insights"
import { isStaticDemo } from "@/lib/runtime"
import { saveTextFile } from "@/lib/download"
import { useSubjectStore } from "@/store/useSubjectStore"
import { failureMessage } from "@/lib/errors"

/** Only the two values the server accepts; anything else means "either". */
function scheduledFromSearch(value: string | null): "" | "yes" | "no" {
  return value === "yes" || value === "no" ? value : ""
}

export default function Knowledge() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedId = searchParams.get("item")
  const scheduled = scheduledFromSearch(searchParams.get("scheduled"))
  return (
    <KnowledgePage
      requestedId={requestedId}
      // In the link, not just in state: "what still needs scheduling?" is a
      // question another page can now send you here to answer, and the answer
      // has to survive the trip.
      scheduled={scheduled}
      onScheduledChange={(value) => {
        const next = new URLSearchParams(searchParams)
        if (value) next.set("scheduled", value)
        else next.delete("scheduled")
        setSearchParams(next)
      }}
      onSelectId={(id) => {
        const next = new URLSearchParams(searchParams)
        next.set("item", id)
        setSearchParams(next)
      }}
    />
  )
}

function KnowledgePage({
  requestedId,
  scheduled,
  onScheduledChange,
  onSelectId,
}: {
  requestedId: string | null
  scheduled: "" | "yes" | "no"
  onScheduledChange(value: "" | "yes" | "no"): void
  onSelectId(id: string): void
}) {
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState<KnowledgeGroup[]>([])
  const [group, setGroup] = useState("")
  const [items, setItems] = useState<KnowledgeItem[]>([])
  // Ids the server says already carry review cards, so 排进复习 tells the truth
  // on first paint instead of only after being pressed.
  const [scheduledIds, setScheduledIds] = useState<ReadonlySet<string>>(new Set())
  const [count, setCount] = useState(0)
  const [fallbackSelectedId, setFallbackSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<KnowledgeItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [requestVersion, setRequestVersion] = useState(0)
  const [tag, setTag] = useState("")
  const [compareA, setCompareA] = useState("")
  const [compareB, setCompareB] = useState("")
  const [compareResult, setCompareResult] = useState<CompareOutput | null>(null)
  const [comparing, setComparing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")
  // Which item's link was just copied, so the button can say so and then stop.
  const [linkCopied, setLinkCopied] = useState("")
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)
  const selectedId = requestedId ?? fallbackSelectedId
  const routeLocation = useLocation()

  /**
   * Copy the address of the item on screen.
   *
   * The page already opens on `?item=`, so this is the link a reader can hand to
   * someone or keep. Composed from the route, not from the address bar: from the
   * Pages build, whose route lives in the hash, `window.location` would drop it.
   */
  async function copyItemLink(id: string) {
    if (!id) return
    const copied = await copyUrl(appUrl(routeLocation.pathname, `?item=${encodeURIComponent(id)}`))
    if (!copied) {
      setError("复制链接失败，请从地址栏复制。")
      return
    }
    setLinkCopied(id)
    window.setTimeout(() => setLinkCopied((current) => (current === id ? "" : current)), 1500)
  }

  /** The filters in hand, as the request they become -- one page at `offset`. */
  const listOptions = useCallback((offset: number): Parameters<typeof listKnowledge>[0] => {
    const options: Parameters<typeof listKnowledge>[0] = { query, group: group || undefined, limit: 100, offset }
    if (subject !== "all") options.subject = subject
    if (tag) options.tag = tag
    if (scheduled) options.scheduled = scheduled
    return options
  }, [query, group, subject, tag, scheduled])

  /**
   * The next page, appended.
   *
   * The list is one request of 100 and the page says how many there are, so
   * without this the library is browsable only as far as its first page --
   * and 搜索 answers "is it there", not "what else is".
   */
  async function loadMore() {
    if (loadingMore) return
    setLoadingMore(true)
    setError("")
    try {
      const result = await listKnowledge(listOptions(items.length))
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...result.items.filter((item) => !seen.has(item.id))]
      })
      setCount(result.count)
      setScheduledIds((current) => new Set([...current, ...(result.scheduled_ids ?? [])]))
    } catch (reason: unknown) {
      setError(failureMessage(reason, "读取更多知识点失败"))
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const options = listOptions(0)
    void listKnowledge(options)
      .then((result) => {
        if (controller.signal.aborted) return
        setItems(result.items)
        setCount(result.count)
        setScheduledIds(new Set(result.scheduled_ids ?? []))
        setFallbackSelectedId((current) =>
          current && result.items.some((item) => item.id === current) ? current : result.items[0]?.id ?? null,
        )
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(failureMessage(reason, "无法读取知识库"))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [listOptions, requestVersion])

  useEffect(() => {
    let active = true
    void listGroups()
      .then((result) => {
        if (active) setGroups(result.items)
      })
      .catch(() => {
        // The group filter is optional; the plain list remains usable.
      })
    return () => {
      active = false
    }
  }, [])

  const selectedSummary = items.find((item) => item.id === selectedId) ?? null
  // The detail wins whenever it is about the item in hand, including when the
  // list never carried that item at all: a 词族 link points at a word the
  // current search, subject or 复习状态 filter has every right to exclude, and
  // a link that dead-ends on the empty panel is a broken link.
  const selected = selectedDetail?.id === selectedId ? selectedDetail : selectedSummary
  // scheduled_ids only describes the page in hand. A 词族 link or an ?item=
  // deep link routinely selects an item that page never carried -- the filter
  // that hid it is the reason the link exists -- and the panel then offered
  // 排进复习 for something already queued. The detail read is by id and answers
  // for that item, so it decides whenever the page has nothing to say.
  const selectedQueued = selected
    ? scheduledIds.has(selected.id) || (selectedDetail?.id === selected.id && selectedDetail.scheduled === true)
    : false
  // Every filter the page can narrow by, except the subject chip: that one is
  // the learner's own lens across pages, not something this page set.
  const filtersActive = Boolean(query.trim() || group || tag || scheduled)

  useEffect(() => {
    if (!selectedId || typeof getKnowledge !== "function") return
    // Nothing to ask for when the row already carries the wiki text, or when
    // the detail in hand is already about this item.
    if (selectedSummary?.detailed_markdown !== undefined) return
    if (selectedDetail?.id === selectedId) return

    let active = true
    void getKnowledge(selectedId)
      .then((item) => {
        if (active) setSelectedDetail(item)
      })
      .catch((reason: unknown) => {
        if (!active || selectedSummary) return
        setError(failureMessage(reason, "无法读取知识点详情"))
      })
    return () => {
      active = false
    }
  }, [selectedId, selectedSummary, selectedDetail, requestVersion])

  function retry() {
    setLoading(true)
    setError("")
    setRequestVersion((value) => value + 1)
  }

  function selectItem(id: string) {
    setError("")
    onSelectId(id)
  }

  // Each subject sorts insights by its own three words, so a tag chosen under
  // one subject can have no control under the next. Dropping it keeps the page
  // honest: a filter still narrowing the list from a dropdown that no longer
  // offers it is one you cannot see, explain, or undo.
  function chooseSubject(next: string) {
    if (tag && !insightTagsFor(next).includes(tag)) setTag("")
    setSubject(next)
  }

  function updateQuery(value: string) {
    setLoading(true)
    setError("")
    setQuery(value)
  }

  // The filters that emptied the list are the ones that can bring it back. The
  // subject chip is left alone: it is the learner's lens across pages.
  function clearFilters() {
    setLoading(true)
    setError("")
    setQuery("")
    setGroup("")
    setTag("")
    onScheduledChange("")
  }

  async function runCompare() {
    if (!compareA || !compareB || compareA === compareB || comparing) return
    setComparing(true)
    try {
      setCompareResult(await compareKnowledge(subject === "all" ? "" : subject, compareA, compareB))
    } catch (reason) {
      setCompareResult(null)
      setError(failureMessage(reason, "对比生成失败"))
    } finally {
      setComparing(false)
    }
  }

  /**
   * Everything on screen, as a file 导入 can read back.
   *
   * The filters travel with it, so the export means "what I am looking at" rather
   * than "everything", which is the difference between a useful file and one the
   * reader has to trim in a spreadsheet.
   */
  async function downloadExport() {
    if (exporting) return
    setExporting(true)
    setExportError("")
    try {
      const text = await exportKnowledge({
        format: "csv",
        query: query.trim() || undefined,
        // Every filter the list is narrowed by, 知识分组 included: an export that
        // ignored one would hand over the whole library from inside a group view.
        group: group || undefined,
        subject: subject === "all" ? undefined : subject,
        tag: tag || undefined,
        scheduled: scheduled || undefined,
      })
      saveTextFile(text, `study-os-知识库-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8")
    } catch (reason) {
      setExportError(failureMessage(reason, "导出失败"))
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <Badge variant="secondary" className="w-fit"><LibraryBig aria-hidden="true" />知识百科</Badge>
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">整理每一个值得记忆的知识点</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">词汇、短语与隐性结论会在这里形成简明卡片和详细百科。</p>
        </div>
        <div className="text-sm text-muted-foreground" aria-live="polite">{loading ? "正在读取…" : `${count} 个知识点`}</div>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">搜索知识库</CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <SubjectChips subject={subject} onSelect={chooseSubject} />
              <label className="flex items-center gap-2 text-sm font-medium" htmlFor="knowledge-group">
                知识分组
                <Select
                  id="knowledge-group"
                  ariaLabel="知识分组"
                  value={group}
                  onValueChange={(value) => {
                    setGroup(value)
                    setLoading(true)
                    setError("")
                  }}
                  placeholder="全部"
                  options={[
                    { value: "", label: "全部" },
                    ...groups.map((item) => ({ value: item.id, label: item.name })),
                  ]}
                  className="min-w-36"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium" htmlFor="knowledge-tag">
                属性
                <Select
                  id="knowledge-tag"
                  ariaLabel="属性"
                  value={tag}
                  onValueChange={(value) => {
                    setTag(value)
                    setLoading(true)
                    setError("")
                  }}
                  placeholder="全部"
                  options={[
                    { value: "", label: "全部" },
                    ...insightTagsFor(subject).map((name) => ({ value: name, label: name })),
                  ]}
                  className="min-w-32"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium" htmlFor="knowledge-scheduled">
                复习状态
                <Select
                  id="knowledge-scheduled"
                  ariaLabel="复习状态"
                  value={scheduled}
                  onValueChange={(value) => {
                    // "" means either; scheduled_ids only describes the page in
                    // hand, so the question has to reach the server.
                    onScheduledChange(value as "" | "yes" | "no")
                    setLoading(true)
                    setError("")
                  }}
                  placeholder="全部"
                  options={[
                    { value: "", label: "全部" },
                    { value: "no", label: "还没排复习" },
                    { value: "yes", label: "已排进复习" },
                  ]}
                  className="min-w-32"
                />
              </label>
            </div>
          </div>
          {/* The groups as a list with numbers, not only as a dropdown: a name on its
              own does not say whether the group is worth opening, and the count comes
              from the same store call the filter itself uses. Groups are hidden when
              the library has none, so an empty library shows no empty heading. */}
          {groups.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">知识分组</span>
              <button
                type="button"
                aria-pressed={group === ""}
                onClick={() => {
                  setGroup("")
                  setLoading(true)
                  setError("")
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  group === ""
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                全部
              </button>
              {groups.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={group === item.id}
                  onClick={() => {
                    setGroup(item.id)
                    setLoading(true)
                    setError("")
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    group === item.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {item.name}
                  {/* -1 is "could not be counted", not zero: showing 0 would claim
                      the group is empty. */}
                  {typeof item.item_count === "number" && item.item_count >= 0 ? (
                    <span className="ml-1.5 tabular-nums opacity-75">{item.item_count}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <label className="relative block" htmlFor="knowledge-search">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="knowledge-search"
              type="search"
              role="searchbox"
              aria-label="搜索知识库"
              placeholder="搜索词汇或定义…"
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              className="h-10 pl-9"
            />
          </label>
          {/* The library could only be read on screen: 导入 could read a file but
              nothing could write one. Same filters as the list, so what leaves
              matches what is in front of the reader. */}
          {isStaticDemo() ? null : (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={exporting}
              onClick={() => void downloadExport()}
            >
              <Download data-icon="inline-start" />
              {exporting ? "导出中…" : "导出 CSV"}
            </Button>
          )}
          {exportError ? (
            <p role="alert" className="text-sm text-destructive">
              {exportError}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 rounded-xl border border-border bg-muted/25 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitCompareArrows aria-hidden="true" className="size-4 text-primary" />
              对比两个知识点
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select
                ariaLabel="对比对象 A"
                value={compareA}
                onValueChange={setCompareA}
                placeholder="选择 A"
                options={items.map((item) => ({ value: item.term, label: item.term }))}
                className="min-w-40"
              />
              <Select
                ariaLabel="对比对象 B"
                value={compareB}
                onValueChange={setCompareB}
                placeholder="选择 B"
                options={items.map((item) => ({ value: item.term, label: item.term }))}
                className="min-w-40"
              />
              <Button size="sm" disabled={!compareA || !compareB || compareA === compareB || comparing} onClick={() => void runCompare()}>
                {comparing ? "生成中…" : "对比"}
              </Button>
            </div>
            {compareResult ? (
              <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm leading-6">
                <p className="font-medium">{compareResult.summary}</p>
                {compareResult.same_points?.length ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">相同点</p>
                    <ul className="ml-4 list-disc">{compareResult.same_points.map((point) => <li key={point}>{point}</li>)}</ul>
                  </div>
                ) : null}
                {compareResult.diff_points?.length ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">不同点</p>
                    <ul className="ml-4 list-disc">{compareResult.diff_points.map((point) => <li key={point}>{point}</li>)}</ul>
                  </div>
                ) : null}
                {compareResult.confusion_point ? <p>易混点：{compareResult.confusion_point}</p> : null}
                {compareResult.memory_tip ? <p className="text-primary">记忆提示：{compareResult.memory_tip}</p> : null}
              </div>
            ) : null}
          </div>
          {error ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={retry}><RotateCcw data-icon="inline-start" />重试</Button>
            </div>
          ) : null}
          {/* The detail panel is where a link is worth having: the page opens on
              `?item=`, so this is the address of what is on screen. */}
          {selected?.id ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copyItemLink(selected.id)}
              >
                <Link2 data-icon="inline-start" />
                {linkCopied === selected.id ? "已复制链接" : "复制链接"}
              </Button>
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[minmax(15rem,22rem)_minmax(0,1fr)]">
            <KnowledgeList
              items={items}
              selectedId={selectedId ?? undefined}
              loading={loading}
              onSelect={(item) => selectItem(item.id)}
              remaining={Math.max(0, count - items.length)}
              loadingMore={loadingMore}
              onLoadMore={() => void loadMore()}
            />
            <WikiPanel
              key={selected?.id ?? "none"}
              item={selected}
              scheduled={selectedQueued}
              unmatched={items.length === 0 && filtersActive}
              onClearFilters={clearFilters}
              onUpdated={(updated) => {
                setItems((currentItems) => currentItems.map((entry) => (entry.id === updated.id ? updated : entry)))
                // 复习状态 is not part of a write response; keep the answer we
                // already had for this item instead of dropping to "unknown".
                setSelectedDetail((current) => ({
                  ...updated,
                  scheduled: updated.scheduled ?? (current?.id === updated.id ? current.scheduled : undefined),
                }))
              }}
              onSelectRelated={selectItem}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

