import { BookOpenText } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import EnglishArticleLibrary from "@/features/english-articles/EnglishArticleLibrary"

export default function EnglishArticles() {
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6">
      <header className="grid gap-2">
        <Badge variant="secondary" className="w-fit"><BookOpenText aria-hidden="true" />精读文章库</Badge>
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">英语时文</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          把英文原文整理成双语精读材料，并从这里继续阅读、重新生成或导出。
        </p>
      </header>
      <EnglishArticleLibrary />
    </section>
  )
}
