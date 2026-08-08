import { useEffect, useState } from "react"
import { GitCompareArrows, LibraryBig, RotateCcw, Search } from "lucide-react"

import { compareKnowledge } from "@/api/chat"
import { getKnowledge, listGroups, listKnowledge, type KnowledgeGroup } from "@/api/knowledge"
import type { CompareOutput, KnowledgeItem } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { SubjectChips } from "@/features/subjects/SubjectChips"
import { KnowledgeList } from "@/features/knowledge/KnowledgeList"
import { WikiPanel } from "@/features/knowledge/WikiPanel"
import { insightTagsFor } from "@/lib/insights"
import { useSubjectStore } from "@/store/useSubjectStore"

export default function Knowledge() {
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState<KnowledgeGroup[]>([])
  const [group, setGroup] = useState("")
  const [items, setItems] = useState<KnowledgeItem[]>([])
  // Ids the server says already carry review cards, so 排进复习 tells the truth
  // on first paint instead of only after being pressed.
  const [scheduledIds, setScheduledIds] = useState<ReadonlySet<string>>(new Set())
  const [count, setCount] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<KnowledgeItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [requestVersion, setRequestVersion] = useState(0)
  const [tag, setTag] = useState("")
  // "" means either. scheduled_ids only describes the page in hand, so the
  // question "what still needs scheduling?" has to be asked of the server.
  const [scheduled, setScheduled] = useState<"" | "yes" | "no">("")
  const [compareA, setCompareA] = useState("")
  const [compareB, setCompareB] = useState("")
  const [compareResult, setCompareResult] = useState<CompareOutput | null>(null)
  const [comparing, setComparing] = useState(false)
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)

  useEffect(() => {
    const controller = new AbortController()
    const options: Parameters<typeof listKnowledge>[0] = {
      query,
      group: group || undefined,
      limit: 100,
      offset: 0,
    }
    if (subject !== "all") options.subject = subject
    if (tag) options.tag = tag
    if (scheduled) options.scheduled = scheduled
    void listKnowledge(options)
      .then((result) => {
        if (controller.signal.aborted) return
        setItems(result.items)
        setCount(result.count)
        setScheduledIds(new Set(result.scheduled_ids ?? []))
        setSelectedId((current) =>
          current && result.items.some((item) => item.id === current) ? current : result.items[0]?.id ?? null,
        )
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : "知识库暂时无法读取，请重试。")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [query, group, subject, tag, scheduled, requestVersion])

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
  const selected = selectedDetail?.id === selectedSummary?.id ? selectedDetail : selectedSummary

  useEffect(() => {
    if (!selectedSummary || selectedSummary.detailed_markdown !== undefined || typeof getKnowledge !== "function") return

    let active = true
    void getKnowledge(selectedSummary.id)
      .then((item) => {
        if (active) setSelectedDetail(item)
      })
      .catch(() => {
        // The summary remains usable when detail retrieval is unavailable.
      })
    return () => {
      active = false
    }
  }, [selectedSummary])

  function retry() {
    setLoading(true)
    setError("")
    setRequestVersion((value) => value + 1)
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

  async function runCompare() {
    if (!compareA || !compareB || compareA === compareB || comparing) return
    setComparing(true)
    try {
      setCompareResult(await compareKnowledge(subject === "all" ? "" : subject, compareA, compareB))
    } catch {
      setCompareResult(null)
      setError("对比生成失败，请确认 AI 服务已配置。")
    } finally {
      setComparing(false)
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
                    setScheduled(value as "" | "yes" | "no")
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
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(15rem,22rem)_minmax(0,1fr)]">
              <KnowledgeList items={items} selectedId={selectedId ?? undefined} loading={loading} onSelect={(item) => setSelectedId(item.id)} />
              <WikiPanel
                key={selected?.id ?? "none"}
                item={selected}
                scheduled={selected ? scheduledIds.has(selected.id) : false}
                onUpdated={(updated) => {
                  setItems((currentItems) => currentItems.map((entry) => (entry.id === updated.id ? updated : entry)))
                  setSelectedDetail(updated)
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
