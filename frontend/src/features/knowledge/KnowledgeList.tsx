import { BookOpenText } from "lucide-react"

import type { KnowledgeItem } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface KnowledgeListProps {
  items: KnowledgeItem[]
  loading?: boolean
  onSelect: (item: KnowledgeItem) => void
  selectedId?: string
}

export function KnowledgeList({ items, loading = false, onSelect, selectedId }: KnowledgeListProps) {
  if (loading) return <p className="py-10 text-center text-sm text-muted-foreground">正在整理知识点…</p>
  if (items.length === 0) return <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">没有找到匹配的知识点</p>

  return (
    <div className="grid content-start gap-2" role="list" aria-label="知识点列表">
      {items.map((item) => (
        <div key={item.id} role="listitem">
          <button
            type="button"
            aria-pressed={item.id === selectedId}
            onClick={() => onSelect(item)}
            className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className={item.id === selectedId ? "ring-2 ring-primary/45" : "hover:bg-muted/35"} size="sm">
              <CardHeader className="gap-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate text-base">{item.term}</CardTitle>
                  <BookOpenText aria-hidden="true" className="size-4 shrink-0 text-primary" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{item.item_type}</Badge>
                  {item.part_of_speech ? <Badge variant="outline">{item.part_of_speech}</Badge> : null}
                  {item.level ? <span className="text-xs text-muted-foreground">{item.level}</span> : null}
                </div>
                <CardDescription className="line-clamp-2">{item.concise_definition}</CardDescription>
              </CardHeader>
            </Card>
          </button>
        </div>
      ))}
    </div>
  )
}
