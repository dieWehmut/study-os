import { useCallback, useEffect, useState } from "react"
import { ArrowRight, BookOpenText, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"

import {
  deleteEnglishArticle,
  listEnglishArticles,
  type EnglishArticle,
} from "@/api/english-articles"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function displayDate(value?: string): string {
  if (!value) return "日期未填写"
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp))
}

function byline(article: EnglishArticle): string {
  return [article.author, article.source_name].filter(Boolean).join(" · ") || "来源未填写"
}

export default function EnglishArticleLibrary() {
  const [articles, setArticles] = useState<EnglishArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [deletingID, setDeletingID] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await listEnglishArticles({ limit: 100 })
      setArticles(response.items)
    } catch {
      setError("无法加载英语时文，请确认本地后端正在运行后重试。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    listEnglishArticles({ limit: 100 })
      .then((response) => {
        if (active) setArticles(response.items)
      })
      .catch(() => {
        if (active) setError("无法加载英语时文，请确认本地后端正在运行后重试。")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function remove(article: EnglishArticle) {
    if (!article.id || deletingID) return
    setDeletingID(article.id)
    setError("")
    try {
      await deleteEnglishArticle(article.id)
      setArticles((current) => current.filter((item) => item.id !== article.id))
    } catch {
      setError(`删除《${article.title}》失败，请重试。`)
    } finally {
      setDeletingID("")
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
        正在整理文章库…
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {articles.length > 0 ? `共 ${articles.length} 篇 · 最近更新在前` : "从一篇原始英文开始建立精读材料"}
        </p>
        {articles.length > 0 ? (
          <Link className={buttonVariants()} to="/reading/articles/new">
            <Plus data-icon="inline-start" />添加文章
          </Link>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw data-icon="inline-start" />重试
          </Button>
        </div>
      ) : null}

      {articles.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-lg border border-dashed px-5 py-14 text-center">
          <BookOpenText aria-hidden="true" className="size-8 text-primary" />
          <div className="grid gap-1">
            <p className="font-heading text-lg font-semibold">还没有英语时文</p>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              粘贴英文原文，让 AI 生成双语段落、重点短语和词汇讲解。
            </p>
          </div>
          <Link className={buttonVariants()} to="/reading/articles/new">
            <Plus data-icon="inline-start" />添加文章
          </Link>
        </div>
      ) : (
        <div role="list" aria-label="英语时文列表" className="divide-y divide-border rounded-lg border bg-card">
          {articles.map((article) => {
            const id = article.id ?? ""
            const sectionCount = article.section_count ?? article.content?.sections.length
            return (
              <article key={id || article.title} role="listitem" className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <Link
                    to={`/reading/articles/${encodeURIComponent(id)}`}
                    className="group inline-flex max-w-full items-center gap-2 font-heading text-base font-semibold leading-6 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 break-words">{article.title}</span>
                    <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                  {article.original_title ? <p className="mt-0.5 truncate text-sm text-muted-foreground">{article.original_title}</p> : null}
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{byline(article)}</span>
                    <span>发布 {displayDate(article.published_at)}</span>
                    {sectionCount !== undefined ? <span>{sectionCount} 章</span> : null}
                    <span>更新 {displayDate(article.updated_at)}</span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={`删除《${article.title}》`}
                  aria-label={`删除《${article.title}》`}
                  disabled={!id || deletingID === id}
                  onClick={() => void remove(article)}
                  className={cn("justify-self-end text-muted-foreground hover:text-destructive", deletingID === id && "animate-pulse")}
                >
                  <Trash2 />
                </Button>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
