import { BookOpenText } from "lucide-react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
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
      <nav aria-label="reading modes" className="flex flex-wrap gap-2 border-b border-border pb-3">
        <Link to="/reading" className={buttonVariants({ variant: "outline", size: "sm" })}>逐节阅读</Link>
        <span className={buttonVariants({ size: "sm" })}>英语时文</span>
        <Link to="/reading/english-corpora" className={buttonVariants({ variant: "outline", size: "sm" })}>英语语料</Link>
      </nav>
      <EnglishArticleLibrary />
    </section>
  )
}
