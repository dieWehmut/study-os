import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ChevronDown, Download, Link2, LoaderCircle, RefreshCw, Trash2 } from "lucide-react"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"

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
import { saveTextFile } from "@/lib/download"
import { appUrlWithHash, copyUrl } from "@/lib/link"
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
  const routeLocation = useLocation()
  const articleRootRef = useRef<HTMLElement>(null)
  const [article, setArticle] = useState<EnglishArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [regenerating, setRegenerating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  // Which section's link was just copied, so the button can say so and then stop.
  const [linkCopied, setLinkCopied] = useState("")

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

  /**
   * Take the article out as Markdown.
   *
   * The app already stores the article as Markdown, so this is the file itself
   * rather than a rendering of the page -- and unlike the PDF it needs nothing
   * from the browser's print pipeline.
   */
  function exportMarkdown() {
    if (!article) return
    saveTextFile(
      article.markdown?.trim() ? article.markdown : `# ${article.title}\n`,
      `${article.title || "article"}${article.id ? `-${article.id}` : ""}.md`,
      "text/markdown;charset=utf-8",
    )
  }

  /**
   * Copy the address of one section.
   *
   * The page has carried section anchors for a while; this is what makes them
   * usable away from the page -- a link to hand to someone, or to keep.
   *
   * Built from the router's location, not from the window: the address bar and the
   * route are two different things here (the desktop shell has no address bar, and
   * the Pages build keeps the route inside the hash). Reading window.location put
   * the section onto the site root.
   */
  async function copySectionLink(sectionID: string) {
    const url = appUrlWithHash(routeLocation.pathname, routeLocation.search, sectionHash(sectionID))
    if (!(await copyUrl(url))) {
      setError("复制链接失败，请从地址栏复制。")
      return
    }
    setLinkCopied(sectionID)
    window.setTimeout(() => setLinkCopied((current) => (current === sectionID ? "" : current)), 1500)
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
          <Button size="sm" variant="ghost" onClick={() => exportMarkdown()}>
            <Download data-icon="inline-start" />导出 Markdown
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
              <div key={sectionID} className="flex items-center gap-1">
                <a
                  href={sectionHash(sectionID)}
                  aria-current={activeID === sectionID ? "true" : undefined}
                  onClick={(event) => {
                    event.preventDefault()
                    goToSection(sectionID)
                    setDirectoryOpen(false)
                  }}
                  className={cn(
                    "min-w-0 flex-1 break-words border-l-2 px-3 py-1.5 text-left text-sm leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activeID === sectionID ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {index + 1}. {section.title}
                </a>
                {/* A section is where a reader stops reading; the address is how they
                    come back to it, and this is the only way to take it away. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`复制「${section.title}」的链接`}
                  title={linkCopied === sectionID ? "已复制" : "复制这一节的链接"}
                  onClick={() => void copySectionLink(sectionID)}
                >
                  <Link2 aria-hidden="true" className="size-3.5" />
                </Button>
              </div>
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
