import { ScanText } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function Reading() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ScanText aria-hidden="true" className="size-4 text-primary" />
        <h1 className="font-heading text-2xl font-semibold tracking-tight">阅读</h1>
      </div>

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>先看结构，再读正文</CardTitle>
          <p className="text-sm text-muted-foreground">
            粘贴一段讲义或笔记，先把它切成能一次读完的小节并预览骨架，再逐节进入正文。
          </p>
        </CardHeader>
        <CardContent />
      </Card>
    </section>
  )
}
