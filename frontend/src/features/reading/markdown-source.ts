const FRONT_MATTER = /^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/u
const WIKI_LINK = /\[\[([^\]|\r\n]+)(?:\|([^\]\r\n]+))?\]\]/gu
const LINE_MARKER = /<span\s+class=["']ody-ln["']\s*>(\d+)<\/span>/gu

export const lineMarkerToken = (line: string): string => `⟦ODY_LN:${line}⟧`

/**
 * Convert the small, deliberately supported Obsidian subset into Markdown
 * understood by react-markdown. Raw HTML is left untouched so it remains
 * escaped by the renderer; only the exact line-marker span is tokenized.
 */
export function normalizeReadingMarkdown(source: string): string {
  let markdown = typeof source === "string" ? source.replace(/\r\n?/gu, "\n") : ""
  markdown = markdown.replace(FRONT_MATTER, "")
  markdown = markdown.replace(WIKI_LINK, (_whole, target: string, label?: string) => {
    const cleanTarget = target.trim()
    const cleanLabel = (label ?? target).trim()
    if (!cleanTarget || !cleanLabel) return cleanLabel
    const href = cleanTarget.startsWith("#") ? cleanTarget : `#${cleanTarget}`
    return `[${cleanLabel}](${href})`
  })
  markdown = markdown.replace(LINE_MARKER, (_whole, line: string) => lineMarkerToken(line))
  return markdown
}

export function calloutTypeFromText(value: string): string | null {
  const match = value.trim().match(/^\[!([A-Za-z][\w-]*)\](?:\s|$)/u)
  return match ? match[1].toLowerCase() : null
}

export function stripCalloutMarker(value: string): string {
  return value.replace(/^\[![A-Za-z][\w-]*\]\s*/u, "")
}
