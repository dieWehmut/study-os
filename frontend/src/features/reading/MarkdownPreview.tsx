import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { Children, cloneElement, createElement, isValidElement, useMemo, type ReactNode } from "react"

import { vocabularyLexicon, type VocabularyLexiconEntry } from "@/generated/vocabulary-lexicon"
import { createVocabularyMatcher, type VocabularyToken } from "@/lib/vocabulary-matcher"
import { calloutTypeFromText, lineMarkerToken, normalizeReadingMarkdown } from "./markdown-source"

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
    if (isValidElement(child)) return plainText(child.props.children)
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
          className="ody-vocabulary-link"
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
    parts.push(<span key={`${keyPrefix}-line-${markerIndex}`} className="ody-ln">{line}</span>)
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
    if (!isValidElement(child)) return child
    if (typeof child.type !== "string") return child
    const tag = typeof child.type === "string" ? child.type : ""
    if (tag === "a" || tag === "code" || tag === "pre") return child
    return cloneElement(child, { key: child.key ?? `node-${index}`, children: renderChildren(child.props.children, matcher, onVocabularySelect) })
  })
}

function blockComponent(
  tag: string,
  matcher: (text: string) => VocabularyToken[],
  onVocabularySelect: MarkdownPreviewProps["onVocabularySelect"],
) {
  return ({ children, node: _node, ...props }: { children?: ReactNode; node?: unknown } & Record<string, unknown>) =>
    createElement(tag, props, renderChildren(children, matcher, onVocabularySelect))
}

export function MarkdownPreview({ markdown, entries = vocabularyLexicon, onVocabularySelect }: MarkdownPreviewProps) {
  const normalized = useMemo(() => normalizeReadingMarkdown(markdown), [markdown])
  const matcher = useMemo(() => createVocabularyMatcher(entries), [entries])
  const inline = (tag: string) => blockComponent(tag, matcher, onVocabularySelect)
  const components: Components = {
    p: inline("p"),
    h1: inline("h1"),
    h2: inline("h2"),
    h3: inline("h3"),
    h4: inline("h4"),
    h5: inline("h5"),
    h6: inline("h6"),
    li: inline("li"),
    td: inline("td"),
    th: inline("th"),
    blockquote: ({ children, node: _node }) => {
      const type = calloutTypeFromText(plainText(children))
      return <blockquote data-callout={type ?? undefined}>{renderChildren(children, matcher, onVocabularySelect)}</blockquote>
    },
    a: ({ children, node: _node, ...props }) => <a {...props}>{children}</a>,
    code: ({ children, node: _node, ...props }) => <code {...props}>{children}</code>,
    pre: ({ children, node: _node, ...props }) => <pre {...props}>{children}</pre>,
  }
  return (
    <div data-testid="markdown-preview" className="ody-markdown-preview min-w-0 leading-7">
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
