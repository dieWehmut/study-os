import { ArrowLeft, Sparkles } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import type { EnglishArticle } from "@/api/english-articles"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import EnglishArticleComposer from "@/features/english-articles/EnglishArticleComposer"

export default function EnglishArticleNew() {
  const navigate = useNavigate()

  function openSaved(article: EnglishArticle) {
    if (!article.id) return
    navigate(`/reading/articles/${encodeURIComponent(article.id)}`)
  }

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6">
      <header className="grid gap-3">
        <Link className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })} to="/reading/articles">
          <ArrowLeft data-icon="inline-start" />返回文章库
        </Link>
        <div className="grid gap-2">
          <Badge variant="secondary" className="w-fit"><Sparkles aria-hidden="true" />AI 精读</Badge>
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">添加英语时文</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            粘贴完整英文文章，生成接近 Nexus 阅读笔记结构的双语章节、重点短语与词汇讲解。
          </p>
        </div>
      </header>
      <EnglishArticleComposer onSaved={openSaved} />
    </section>
  )
}
