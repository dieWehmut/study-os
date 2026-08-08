import { useMemo, useState } from "react"
import { ScanText } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { FocusReader } from "@/features/reading/FocusReader"
import { StructurePreview } from "@/features/reading/StructurePreview"
import { chunkMarkdown } from "@/lib/chunk"

export default function Reading() {
  const [markdown, setMarkdown] = useState("")
  const [index, setIndex] = useState(0)

  const chunks = useMemo(() => chunkMarkdown(markdown), [markdown])

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
        <CardContent>
          <Textarea
            aria-label="原文"
            value={markdown}
            onChange={(event) => {
              setMarkdown(event.target.value)
              // A new document has a new set of stops; keeping the old position
              // would drop the reader somewhere arbitrary in it.
              setIndex(0)
            }}
            placeholder={"# 标题\n## 小节\n正文…"}
            className="min-h-40 font-mono text-xs"
          />
        </CardContent>
      </Card>

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
              onSelect={(chunk) => setIndex(chunks.findIndex((item) => item.id === chunk.id))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle>正文</CardTitle>
            <p className="text-sm text-muted-foreground">
              一次只放一节，方向键翻页。
            </p>
          </CardHeader>
          <CardContent>
            <FocusReader chunks={chunks} index={index} onIndexChange={setIndex} />
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
