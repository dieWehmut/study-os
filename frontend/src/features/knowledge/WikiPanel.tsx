import ReactMarkdown from "react-markdown"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"

import type { KnowledgeItem } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface WikiPanelProps {
  item: KnowledgeItem | null
}

export function WikiPanel({ item }: WikiPanelProps) {
  if (!item) {
    return (
      <Card className="min-h-64 border-dashed">
        <CardContent className="grid min-h-64 place-items-center text-center text-sm text-muted-foreground">选择一个知识点查看 Wiki</CardContent>
      </Card>
    )
  }

  return (
    <Card key={item.id} className="min-w-0">
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{item.item_type}</Badge>
          {item.level ? <Badge variant="outline">{item.level}</Badge> : null}
          {item.tags?.map((tag) => <Badge key={tag} variant="ghost">#{tag}</Badge>)}
        </div>
        <h2 className="font-heading text-3xl font-medium tracking-tight">{item.term}</h2>
        {item.part_of_speech || item.pronunciation ? (
          <CardDescription>{[item.part_of_speech, item.pronunciation].filter(Boolean).join(" · ")}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="pt-4">
        <Tabs defaultValue="concise">
          <TabsList aria-label="Wiki视图">
            <TabsTrigger value="concise">简明</TabsTrigger>
            <TabsTrigger value="detail">详细 Wiki</TabsTrigger>
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
            {item.detailed_markdown ? (
              <div className="grid gap-3 leading-7 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:font-heading [&_h1]:text-2xl [&_h2]:font-heading [&_h2]:text-xl [&_h3]:font-heading [&_h3]:text-lg [&_li]:ml-5 [&_li]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3">
                <ReactMarkdown
                  remarkPlugins={[remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  urlTransform={(url) => (/^(https?:|mailto:)/i.test(url) ? url : "")}
                >
                  {item.detailed_markdown}
                </ReactMarkdown>
              </div>
            ) : <p className="text-sm text-muted-foreground">这个知识点还没有详细 Wiki。</p>}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
