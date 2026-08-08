import { useState } from "react"
import { ScanText } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { StructurePreview } from "@/features/reading/StructurePreview"

export default function Reading() {
  const [markdown, setMarkdown] = useState("")

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ScanText aria-hidden="true" className="size-4 text-primary" />
        <h1 className="font-heading text-2xl font-semibold tracking-tight">阅读</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
              onChange={(event) => setMarkdown(event.target.value)}
              placeholder={"# 标题\n## 小节\n正文…"}
              className="min-h-80 font-mono text-xs"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle>结构</CardTitle>
            <p className="text-sm text-muted-foreground">
              先看这一栏：有几站、多深、多重，正式读的时候就只用装内容。
            </p>
          </CardHeader>
          <CardContent>
            <StructurePreview markdown={markdown} />
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
