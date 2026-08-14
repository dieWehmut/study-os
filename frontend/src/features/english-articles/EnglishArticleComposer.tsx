import { useRef, useState, type ReactNode } from "react"
import { BookOpenCheck, LoaderCircle, Save, Sparkles } from "lucide-react"

import {
  createEnglishArticle,
  generateEnglishArticle,
  type EnglishArticle,
  type EnglishArticleInput,
} from "@/api/english-articles"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

interface EnglishArticleComposerProps {
  onSaved?: (article: EnglishArticle) => void
  renderPreview?: (article: EnglishArticle) => ReactNode
}

const emptyInput: EnglishArticleInput = { original_text: "" }

function CompactPreview({ article }: { article: EnglishArticle }) {
  const sections = article.content?.sections ?? []
  return (
    <article className="grid gap-7" aria-label="英语时文预览">
      <header className="grid gap-1 border-b pb-4">
        <h2 className="font-heading text-2xl font-semibold leading-tight">{article.title}</h2>
        {article.original_title ? <p className="text-sm text-muted-foreground">{article.original_title}</p> : null}
        <p className="text-xs text-muted-foreground">
          {[article.content?.metadata.author, article.content?.metadata.source_name, article.content?.metadata.published_at].filter(Boolean).join(" · ")}
        </p>
      </header>
      {sections.map((section, sectionIndex) => (
        <section key={`${section.title}-${sectionIndex}`} className="grid gap-4">
          <h3 className="font-heading text-xl font-semibold">{sectionIndex + 1}. {section.title}</h3>
          {section.paragraphs.map((paragraph, paragraphIndex) => (
            <div key={paragraphIndex} className="grid gap-2 border-l-2 border-primary/30 pl-4">
              <p className="leading-8">
                {paragraph.segments.map((segment, segmentIndex) => segment.emphasized ? (
                  <u key={segmentIndex} className="decoration-2 underline-offset-4">{segment.text}</u>
                ) : <span key={segmentIndex}>{segment.text}</span>)}
              </p>
              <p className="leading-7 text-muted-foreground">{paragraph.translation}</p>
            </div>
          ))}
          {section.vocabulary && section.vocabulary.length > 0 ? (
            <dl className="grid gap-3 border-t pt-4 sm:grid-cols-2">
              {section.vocabulary.map((entry, entryIndex) => (
                <div key={`${entry.term}-${entryIndex}`} className="min-w-0">
                  <dt className="overflow-wrap-anywhere font-semibold">{entry.term}</dt>
                  <dd className="text-sm leading-6 text-muted-foreground">{entry.definition}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ))}
    </article>
  )
}

export default function EnglishArticleComposer({ onSaved, renderPreview }: EnglishArticleComposerProps) {
  const [input, setInput] = useState<EnglishArticleInput>(emptyInput)
  const [preview, setPreview] = useState<EnglishArticle | null>(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const inputVersion = useRef(0)

  function update<K extends keyof EnglishArticleInput>(key: K, value: EnglishArticleInput[K]) {
    inputVersion.current += 1
    setPreview(null)
    setError("")
    setInput((current) => ({ ...current, [key]: value }))
  }

  async function generate() {
    if (generating || saving) return
    if (!input.original_text.trim()) {
      setError("请输入英文原文后再生成预览。")
      return
    }
    setGenerating(true)
    setError("")
    const version = inputVersion.current
    try {
      const generated = await generateEnglishArticle(input)
      if (version === inputVersion.current) setPreview(generated)
    } catch {
      setError("生成失败。已保留全部原文和来源信息，请检查 AI 设置后重试。")
    } finally {
      setGenerating(false)
    }
  }

  async function save() {
    if (!preview || saving || generating) return
    setSaving(true)
    setError("")
    try {
      const article = await createEnglishArticle({
        ...preview,
        original_text: input.original_text,
      })
      onSaved?.(article)
    } catch {
      setError("保存失败。预览仍在，可以直接再次保存。")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>原文与来源</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            只需英文原文即可生成；标题、作者和来源会优先保留为文章事实。
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm">
              <span>原文标题</span>
              <Input aria-label="原文标题" value={input.original_title ?? ""} onChange={(event) => update("original_title", event.target.value)} placeholder="可选" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>中文展示标题</span>
              <Input aria-label="中文展示标题" value={input.title ?? ""} onChange={(event) => update("title", event.target.value)} placeholder="可选，AI 可生成" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>作者</span>
              <Input aria-label="作者" value={input.author ?? ""} onChange={(event) => update("author", event.target.value)} placeholder="可选" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>来源</span>
              <Input aria-label="来源" value={input.source_name ?? ""} onChange={(event) => update("source_name", event.target.value)} placeholder="例如 The Economist" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>来源网址</span>
              <Input type="url" aria-label="来源网址" value={input.source_url ?? ""} onChange={(event) => update("source_url", event.target.value)} placeholder="https://…" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>发布日期</span>
              <Input type="date" aria-label="发布日期" value={input.published_at ?? ""} onChange={(event) => update("published_at", event.target.value)} />
            </label>
          </div>
          <label className="grid gap-1.5 text-sm">
            <span>英文原文 <span className="text-destructive">*</span></span>
            <Textarea
              aria-label="英文原文"
              value={input.original_text}
              onChange={(event) => update("original_text", event.target.value)}
              placeholder="Paste the complete English article here…"
              className="min-h-64 resize-y font-sans leading-7"
            />
          </label>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={generating || saving} onClick={() => void generate()}>
              {generating ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Sparkles data-icon="inline-start" />}
              {generating ? "生成中…" : preview ? "重新生成预览" : "生成预览"}
            </Button>
            {preview ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-primary">
                <BookOpenCheck aria-hidden="true" className="size-4" />预览已通过后端校验
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader className="gap-1.5 border-b">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle>保存前预览</CardTitle>
                <p className="text-sm text-muted-foreground">确认标题、翻译与词汇讲解后再写入文章库。</p>
              </div>
              <Button disabled={saving || generating} onClick={() => void save()}>
                {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
                {saving ? "保存中…" : "保存文章"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-1">
            {renderPreview ? renderPreview(preview) : <CompactPreview article={preview} />}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
