import ReactMarkdown from "react-markdown"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { useState } from "react"
import { BookOpenText, ChevronLeft, ChevronRight } from "lucide-react"

import { updateKnowledgeTag } from "@/api/chat"
import type { KnowledgeItem } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { itemTypeLabel } from "@/lib/labels"
import { subjectName } from "@/lib/subjects"

interface WikiPanelProps {
  item: KnowledgeItem | null
  onUpdated?: (item: KnowledgeItem) => void
}

const attributeTags = ["二级结论", "解题策略", "易错信号"]

function chunkMarkdown(markdown: string): string[] {
  const chunks = markdown.split(/(?=^#{1,6} )/m).map((chunk) => chunk.trim()).filter(Boolean)
  return chunks.length > 0 ? chunks : [markdown]
}

export function WikiPanel({ item, onUpdated }: WikiPanelProps) {
  const [tagOverride, setTagOverride] = useState<string[] | null>(null)
  const [chunkIndex, setChunkIndex] = useState(0)
  const [tagPending, setTagPending] = useState("")
  const current: KnowledgeItem | null = item ? { ...item, tags: tagOverride ?? item.tags } : null

  const chunks = current?.detailed_markdown ? chunkMarkdown(current.detailed_markdown) : []

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
          {item.subject ? <Badge variant="outline">{subjectName(item.subject)}</Badge> : null}
          {item.level ? <Badge variant="outline">{item.level}</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {attributeTags.map((tag) => {
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
        </div>
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
        </Tabs>
      </CardContent>
    </Card>
  )
}
