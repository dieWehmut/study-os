import { useEffect, useState } from "react"
import { LibraryBig, RotateCcw, Search } from "lucide-react"

import { getKnowledge, listGroups, listKnowledge, type KnowledgeGroup } from "@/api/knowledge"
import type { KnowledgeItem } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { KnowledgeList } from "@/features/knowledge/KnowledgeList"
import { WikiPanel } from "@/features/knowledge/WikiPanel"

export default function Knowledge() {
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState<KnowledgeGroup[]>([])
  const [group, setGroup] = useState("")
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [count, setCount] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<KnowledgeItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void listKnowledge({ query, group: group || undefined, limit: 100, offset: 0 })
      .then((result) => {
        if (controller.signal.aborted) return
        setItems(result.items)
        setCount(result.count)
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
  }, [query, group, requestVersion])

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

  function updateQuery(value: string) {
    setLoading(true)
    setError("")
    setQuery(value)
  }

  return (
    <section className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <Badge variant="secondary" className="w-fit"><LibraryBig aria-hidden="true" />知识 Wiki</Badge>
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">整理每一个值得记忆的知识点</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">词汇、短语与隐性结论会在这里形成简明卡片和详细 Wiki。</p>
        </div>
        <div className="text-sm text-muted-foreground" aria-live="polite">{loading ? "正在读取…" : `${count} 个知识点`}</div>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">搜索知识库</CardTitle>
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
          {error ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={retry}><RotateCcw data-icon="inline-start" />重试</Button>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(15rem,22rem)_minmax(0,1fr)]">
              <KnowledgeList items={items} selectedId={selectedId ?? undefined} loading={loading} onSelect={(item) => setSelectedId(item.id)} />
              <WikiPanel item={selected} />
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
