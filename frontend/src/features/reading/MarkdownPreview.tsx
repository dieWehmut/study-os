import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { Children, cloneElement, createElement, isValidElement, useMemo, type ComponentType, type JSX, type ReactNode } from "react"

import { vocabularyLexicon, type VocabularyLexiconEntry } from "@/generated/vocabulary-lexicon"
import { createVocabularyMatcher, type VocabularyToken } from "@/lib/vocabulary-matcher"
import { cn } from "@/lib/utils"
import { calloutTypeFromText, normalizeReadingMarkdown } from "./markdown-source"

export interface VocabularySelection {
  term: string
  display: string
  kind: "word" | "expression"
  context: string
  anchor: HTMLElement
}

interface MarkdownPreviewProps {
  markdown: string
  entries?: readonly VocabularyLexiconEntry[]
  onVocabularySelect(selection: VocabularySelection): void
}

const vocabularyAria = "\u67e5\u8bcd"

function plainText(value: ReactNode): string {
  return Children.toArray(value).map((child) => {
    if (typeof child === "string" || typeof child === "number" ) return String(child)
    if (isValidElement<{ children?: ReactNode }>(child)) return plainText(child.props.children)
    return ""
  }).join("")
}

function renderText(
  value: string,
  matcher: (text: string) => VocabularyToken[],
  context: string,
  onVocabularySelect: MarkdownPreviewProps["onVocabularySelect"],
  keyPrefix: string,
): ReactNode[] {
  const parts: ReactNode[] = []
  const marker = /⟦ODY_LN:(\d+)⟧/gu
  let cursor = 0
  let match: RegExpExecArray | null
  let markerIndex = 0
  const appendTokens = (text: string, prefix: string) => {
    if (!text) return
    matcher(text).forEach((token, index) => {
      if (token.term === null) {
        parts.push(token.text)
        return
      }
      parts.push(
        <button
          key={`${prefix}-vocab-${index}`}
          type="button"
          className="ody-vocabulary-link rounded-sm text-primary underline decoration-primary/40 decoration-dotted underline-offset-4 transition-colors hover:bg-primary/10 hover:decoration-primary focus-visible:ring-2 focus-visible:ring-ring"
          data-vocabulary-term={token.term}
          data-vocabulary-kind={token.kind ?? undefined}
          aria-label={`${vocabularyAria} ${token.term}`}
          onClick={(event) => {
            const entry = token.entry
            onVocabularySelect({
              term: token.term ?? "",
              display: entry?.display ?? token.text,
              kind: entry?.kind ?? "word",
              context,
              anchor: event.currentTarget,
            })
          }}
        >
          {token.text}
        </button>,
      )
    })
  }
  while ((match = marker.exec(value))) {
    appendTokens(value.slice(cursor, match.index), `${keyPrefix}-${markerIndex}`)
    const line = match[1]
    parts.push(<span key={`${keyPrefix}-line-${markerIndex}`} className="ody-ln mr-2 inline-flex rounded border border-border bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{line}</span>)
    markerIndex += 1
    cursor = match.index + match[0].length
  }
  appendTokens(value.slice(cursor), `${keyPrefix}-${markerIndex}`)
  return parts
}

function renderChildren(
  children: ReactNode,
  matcher: (text: string) => VocabularyToken[],
  onVocabularySelect: MarkdownPreviewProps["onVocabularySelect"],
): ReactNode {
  const context = plainText(children)
  return Children.toArray(children).map((child, index) => {
    if (typeof child === "string") {
      return renderText(child, matcher, context, onVocabularySelect, `text-${index}`)
    }
    if (!isValidElement<{ children?: ReactNode }>(child)) return child
    if (typeof child.type !== "string") return child
    const tag = typeof child.type === "string" ? child.type : ""
    if (tag === "a" || tag === "code" || tag === "pre") return child
    return cloneElement(child, { key: child.key ?? `node-${index}`, children: renderChildren(child.props.children, matcher, onVocabularySelect) })
  })
}

function withoutNode(props: Record<string, unknown>): Record<string, unknown> {
  const domProps = { ...props }
  delete domProps.node
  return domProps
}

function blockComponent<Tag extends keyof JSX.IntrinsicElements>(
  tag: Tag,
  matcher: (text: string) => VocabularyToken[],
  onVocabularySelect: MarkdownPreviewProps["onVocabularySelect"],
  baseClass?: string,
): ComponentType<JSX.IntrinsicElements[Tag] & ExtraProps> {
  return ({ children, node, className, ...props }) => {
    void node
    return createElement(
      tag,
      { ...props, className: cn(baseClass, className) } as JSX.IntrinsicElements[Tag],
      renderChildren(children, matcher, onVocabularySelect),
    )
  }
}

export function MarkdownPreview({ markdown, entries = vocabularyLexicon, onVocabularySelect }: MarkdownPreviewProps) {
  const normalized = useMemo(() => normalizeReadingMarkdown(markdown), [markdown])
  const matcher = useMemo(() => createVocabularyMatcher(entries), [entries])
  const components = useMemo<Components>(() => {
    const inline = <Tag extends keyof JSX.IntrinsicElements>(tag: Tag, className?: string) =>
      blockComponent(tag, matcher, onVocabularySelect, className)
    return {
      p: inline("p", "my-3 first:mt-0 last:mb-0"),
      h1: inline("h1", "mb-4 mt-1 font-heading text-2xl font-semibold leading-tight"),
      h2: inline("h2", "mb-3 mt-6 border-b border-border pb-2 font-heading text-xl font-semibold leading-tight first:mt-0"),
      h3: inline("h3", "mb-2 mt-5 font-heading text-lg font-semibold leading-snug"),
      h4: inline("h4", "mb-2 mt-4 font-heading text-base font-semibold"),
      h5: inline("h5", "mb-2 mt-4 text-sm font-semibold"),
      h6: inline("h6", "mb-2 mt-4 text-sm font-medium text-muted-foreground"),
      li: inline("li", "my-1 pl-1"),
      td: inline("td", "border border-border px-3 py-2 align-top"),
      th: inline("th", "border border-border bg-muted/60 px-3 py-2 font-semibold"),
      ul: ({ children, className, ...props }) => <ul {...withoutNode(props)} className={cn("my-3 list-disc pl-5", className)}>{children}</ul>,
      ol: ({ children, className, ...props }) => <ol {...withoutNode(props)} className={cn("my-3 list-decimal pl-5", className)}>{children}</ol>,
      table: ({ children, className, ...props }) => (
        <div className="my-4 max-w-full overflow-x-auto">
          <table {...withoutNode(props)} className={cn("w-full border-collapse text-left text-sm", className)}>{children}</table>
        </div>
      ),
      blockquote: ({ children, className, ...props }) => {
        const type = calloutTypeFromText(plainText(children))
        return (
          <blockquote
            {...withoutNode(props)}
            data-callout={type ?? undefined}
            className={cn("my-4 rounded-r-lg border-l-2 border-primary/45 bg-primary/5 px-4 py-3 text-muted-foreground", className)}
          >
            {renderChildren(children, matcher, onVocabularySelect)}
          </blockquote>
        )
      },
      a: ({ children, className, ...props }) => <a {...withoutNode(props)} className={cn("text-primary underline underline-offset-4", className)}>{children}</a>,
      code: ({ children, className, ...props }) => <code {...withoutNode(props)} className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)}>{children}</code>,
      pre: ({ children, className, ...props }) => <pre {...withoutNode(props)} className={cn("my-4 overflow-x-auto rounded-lg bg-muted p-3 text-sm [&_code]:bg-transparent [&_code]:p-0", className)}>{children}</pre>,
    }
  }, [matcher, onVocabularySelect])
  return (
    <div data-testid="markdown-preview" className="ody-markdown-preview min-w-0 text-[0.95rem] leading-7 text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
        urlTransform={(url) => (/^(?:https?:|mailto:|#)/iu.test(url) ? url : "")}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
}
