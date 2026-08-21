import { useEffect, useMemo, useState } from "react"
import { BookMarked, ExternalLink, Search } from "lucide-react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ENGLISH_CORPORA,
  englishCorpusAssetURL,
  loadEnglishCorpus,
  type EnglishCorpusEntry,
} from "@/features/english-corpora/english-corpora"
import { cn } from "@/lib/utils"

const visibleLimit = 120

export default function EnglishCorpora() {
  const [activeID, setActiveID] = useState(ENGLISH_CORPORA[0].id)
  const [entries, setEntries] = useState<Record<string, EnglishCorpusEntry[]>>({})
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const active = ENGLISH_CORPORA.find((corpus) => corpus.id === activeID) ?? ENGLISH_CORPORA[0]

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all(
      ENGLISH_CORPORA.map(async (corpus) => [corpus.id, (await loadEnglishCorpus(corpus, controller.signal)).entries] as const),
    )
      .then((loaded) => setEntries(Object.fromEntries(loaded)))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "无法读取内置英语语料")
        }
      })
    return () => controller.abort()
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const source = entries[active.id] ?? []
    if (!needle) return source
    return source.filter((entry) =>
      `${entry.label} ${entry.target} ${entry.kind}`.toLocaleLowerCase().includes(needle),
    )
  }, [active.id, entries, query])

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6">
      <header className="grid gap-2">
        <Badge variant="secondary" className="w-fit"><BookMarked aria-hidden="true" />内置英语语料</Badge>
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">英语词汇与表达库</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          直接使用项目内置的 Word Wiki 与多词表达索引，本地应用和 GitHub Pages 内容一致。
        </p>
      </header>

      <nav aria-label="reading modes" className="flex flex-wrap gap-2 border-b border-border pb-3">
        <Link to="/reading" className={buttonVariants({ variant: "outline", size: "sm" })}>逐节阅读</Link>
        <Link to="/reading/articles" className={buttonVariants({ variant: "outline", size: "sm" })}>英语时文</Link>
        <span className={buttonVariants({ size: "sm" })}>英语语料</span>
      </nav>

      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="英语语料库">
          {ENGLISH_CORPORA.map((corpus) => (
            <Button
              key={corpus.id}
              type="button"
              role="tab"
              size="sm"
              variant={corpus.id === active.id ? "default" : "outline"}
              aria-selected={corpus.id === active.id}
              onClick={() => {
                setActiveID(corpus.id)
                setQuery("")
              }}
            >
              {corpus.title} · {corpus.total}
            </Button>
          ))}
        </div>

        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="搜索英语语料"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`搜索 ${active.title}`}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>{active.description} 当前匹配 {filtered.length} 条。</p>
          <a
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-primary")}
            href={englishCorpusAssetURL(active)}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink data-icon="inline-start" />打开完整 Markdown
          </a>
        </div>

        {error ? <p role="alert" className="rounded-lg border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}

        {!error && !entries[active.id] ? (
          <p className="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">正在读取语料…</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">没有匹配的词条。</p>
        ) : (
          <div role="list" aria-label={`${active.title} 词条`} className="divide-y divide-border rounded-lg border bg-card">
            {filtered.slice(0, visibleLimit).map((entry) => (
              <div key={entry.id} role="listitem" className="flex min-w-0 items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 break-words text-sm font-medium">{entry.label}</span>
                <span className="shrink-0 rounded-md border border-border bg-muted/35 px-1.5 py-0.5 text-[0.68rem] text-muted-foreground">{entry.kind}</span>
              </div>
            ))}
          </div>
        )}
        {filtered.length > visibleLimit ? (
          <p className="text-center text-xs text-muted-foreground">仅显示前 {visibleLimit} 条，请继续输入关键词缩小范围。</p>
        ) : null}
      </div>
    </section>
  )
}
