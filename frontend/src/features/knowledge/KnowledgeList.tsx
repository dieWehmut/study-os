import { BookOpenText } from "lucide-react"

import type { KnowledgeItem } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { itemTypeLabel } from "@/lib/labels"
import { SubjectBadge } from "@/features/subjects/SubjectBadge"

interface KnowledgeListProps {
  items: KnowledgeItem[]
  loading?: boolean
  onSelect: (item: KnowledgeItem) => void
  selectedId?: string
  /** How many the server says match, when that is more than are in hand. */
  remaining?: number
  loadingMore?: boolean
  onLoadMore?: () => void
}

export function KnowledgeList({
  items,
  loading = false,
  onSelect,
  selectedId,
  remaining = 0,
  loadingMore = false,
  onLoadMore,
}: KnowledgeListProps) {
  if (loading) return <p className="py-10 text-center text-sm text-muted-foreground">正在整理知识点…</p>
  if (items.length === 0) return <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">没有找到匹配的知识点</p>

  return (
    <div className="grid content-start gap-2">
      <div className="grid content-start gap-2" role="list" aria-label="知识点列表">
      {items.map((item) => (
        <div key={item.id} role="listitem">
          <button
            type="button"
            aria-pressed={item.id === selectedId}
            aria-current={item.id === selectedId ? "true" : undefined}
            onClick={() => onSelect(item)}
            className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className={item.id === selectedId ? "ring-2 ring-primary/50 shadow-sm" : "transition-colors hover:bg-muted/40"} size="sm">
              <CardHeader className="gap-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate text-base">{item.term}</CardTitle>
                  <BookOpenText aria-hidden="true" className="size-4 shrink-0 text-primary" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{itemTypeLabel(item.item_type)}</Badge>
                  {item.part_of_speech ? <Badge variant="outline">{item.part_of_speech}</Badge> : null}
                  {item.subject ? <SubjectBadge subject={item.subject} /> : null}
                  {item.level ? <span className="text-xs text-muted-foreground">{item.level}</span> : null}
                </div>
                <CardDescription className="line-clamp-2">{item.concise_definition}</CardDescription>
              </CardHeader>
            </Card>
          </button>
        </div>
      ))}
      </div>
      {/* Said as well as offered: the count is what tells you whether there is
          anything left to look at, and "加载更多" alone does not. */}
      {onLoadMore && remaining > 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-1 w-full"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "正在读取…" : `加载更多（还有 ${remaining} 条）`}
        </Button>
      ) : null}
    </div>
  )
}
