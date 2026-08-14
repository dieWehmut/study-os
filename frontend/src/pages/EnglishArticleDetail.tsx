import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ChevronDown, Download, LoaderCircle, RefreshCw, Trash2 } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"

import { playPronunciation } from "@/api/audio"
import {
  deleteEnglishArticle,
  getEnglishArticle,
  regenerateEnglishArticle,
  type EnglishArticle,
} from "@/api/english-articles"
import { ApiError } from "@/api/client"
import { Button, buttonVariants } from "@/components/ui/button"
import { EnglishArticleBody } from "@/features/english-articles/EnglishArticleBody"
import { exportArticlePdf } from "@/features/english-articles/export-pdf"
import { articleSectionID, sectionHash } from "@/features/english-articles/article-sections"
import { useArticleSectionRoute } from "@/features/english-articles/useArticleSectionRoute"
import { cn } from "@/lib/utils"

function metadata(article: EnglishArticle) {
  const contentMetadata = article.content?.metadata
  return {
    originalTitle: article.original_title || contentMetadata?.original_title,
    author: article.author || contentMetadata?.author,
    sourceName: article.source_name || contentMetadata?.source_name,
    sourceURL: article.source_url || contentMetadata?.source_url,
    publishedAt: article.published_at || contentMetadata?.published_at,
  }
}

function messageForLoad(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return "文章不存在，可能已经被删除。"
  return "无法加载文章，请确认本地后端正在运行后重试。"
}

export default function EnglishArticleDetail() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const articleRootRef = useRef<HTMLElement>(null)
  const [article, setArticle] = useState<EnglishArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [regenerating, setRegenerating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)

  const sectionIDs = useMemo(
    () => (article?.content?.sections ?? []).map((section, index) => articleSectionID(section.title, index)),
    [article?.content?.sections],
  )
  const { activeID, goToSection } = useArticleSectionRoute(sectionIDs)

  useEffect(() => {
    let active = true
    if (!id) {
      return () => { active = false }
    }
    getEnglishArticle(id)
      .then((value) => {
        if (active) setArticle(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(messageForLoad(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [id])

  async function regenerate() {
    if (!id || regenerating || deleting || !article) return
    setRegenerating(true)
    setError("")
    try {
      setArticle(await regenerateEnglishArticle(id))
    } catch {
      setError("重新生成失败，旧文章内容保持不变，请稍后重试。")
    } finally {
      setRegenerating(false)
    }
  }

  async function remove() {
    if (!id || deleting || regenerating) return
    setDeleting(true)
    setError("")
    try {
      await deleteEnglishArticle(id)
      navigate("/reading/articles", { replace: true })
    } catch {
      setError("删除失败，文章仍然保留。")
      setDeleting(false)
    }
  }

  async function exportPDF() {
    const root = articleRootRef.current
    if (!root || !article || exporting) return
    setExporting(true)
    setError("")
    try {
      await exportArticlePdf(root, article.title)
    } catch {
      setError("PDF 导出失败，请稍后重试。")
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">正在打开文章…</p>
  }

  if (!article?.content) {
    return (
      <section className="mx-auto grid w-full max-w-3xl gap-5">
        <Link className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })} to="/reading/articles">
          <ArrowLeft data-icon="inline-start" />返回文章库
        </Link>
        <p role="alert" className="rounded-lg border border-destructive/35 bg-destructive/5 px-4 py-4 text-sm text-destructive">
          {error || (id ? "文章内容为空。" : "文章不存在，缺少文章编号。")}
        </p>
      </section>
    )
  }

  const info = metadata(article)
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })} to="/reading/articles">
          <ArrowLeft data-icon="inline-start" />返回文章库
        </Link>
        <div role="toolbar" aria-label="文章工具" data-pdf-ignore className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={regenerating || deleting || exporting} onClick={() => void regenerate()}>
            {regenerating ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
            {regenerating ? "重新生成中…" : "重新生成"}
          </Button>
          <Button size="sm" variant="outline" disabled={regenerating || deleting || exporting} onClick={() => void exportPDF()}>
            {exporting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Download data-icon="inline-start" />}
            {exporting ? "导出中…" : "导出 PDF"}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={regenerating || deleting || exporting} onClick={() => void remove()}>
            {deleting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}
            {deleting ? "删除中…" : "删除"}
          </Button>
        </div>
      </div>

      {error ? <p role="alert" className="rounded-lg border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,12rem)_minmax(0,46rem)] lg:justify-center lg:items-start">
        <nav role="navigation" aria-label="文章目录" className="order-first lg:sticky lg:top-24 lg:grid lg:gap-2" data-pdf-ignore>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm font-medium lg:hidden"
            aria-expanded={directoryOpen}
            onClick={() => setDirectoryOpen((open) => !open)}
          >
            章节目录
            <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", directoryOpen && "rotate-180")} />
          </button>
          <p className="hidden text-xs font-medium uppercase tracking-normal text-muted-foreground lg:block">章节目录</p>
          <div className={cn("grid gap-2", !directoryOpen && "hidden lg:grid")}>
          {article.content.sections.map((section, index) => {
            const sectionID = sectionIDs[index]
            return (
              <a
                key={sectionID}
                href={sectionHash(sectionID)}
                aria-current={activeID === sectionID ? "true" : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  goToSection(sectionID)
                  setDirectoryOpen(false)
                }}
                className={cn(
                  "break-words border-l-2 px-3 py-1.5 text-left text-sm leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  activeID === sectionID ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {index + 1}. {section.title}
              </a>
            )
          })}
          </div>
        </nav>

        <article ref={articleRootRef} data-article-root className="min-w-0">
          <header className="grid gap-3 border-b border-border pb-6">
            <h1 className="break-words font-heading text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{article.title}</h1>
            {info.originalTitle ? <p className="break-words text-lg text-muted-foreground">{info.originalTitle}</p> : null}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {info.author ? <span>{info.author}</span> : null}
              {info.sourceURL ? <a className="break-all text-primary underline underline-offset-2" href={info.sourceURL} target="_blank" rel="noreferrer">{info.sourceName || info.sourceURL}</a> : info.sourceName ? <span>{info.sourceName}</span> : null}
              {info.publishedAt ? <time dateTime={info.publishedAt}>{info.publishedAt}</time> : null}
            </div>
          </header>
          <div className="pt-8">
            <EnglishArticleBody content={article.content} onSpeak={(term) => void playPronunciation(term)} />
          </div>
        </article>
      </div>
    </section>
  )
}
