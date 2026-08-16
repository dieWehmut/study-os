import { vocabularyLexicon } from "../generated/vocabulary-lexicon"
import type { VocabularyLexiconEntry } from "../generated/vocabulary-lexicon"

export type VocabularyKind = VocabularyLexiconEntry["kind"]

export interface VocabularySpan {
  start: number
  end: number
}

export interface VocabularyToken {
  start: number
  end: number
  text: string
  normalized: string | null
  /** Alias kept for renderer/popover callers that use the lookup term name. */
  term: string | null
  kind: VocabularyKind | null
  entry: VocabularyLexiconEntry | null
}

export interface VocabularyMatcherOptions {
  /** Supply precomputed protected ranges when a Markdown AST already exists. */
  protectedSpans?: readonly VocabularySpan[]
  /** Disable the lightweight Markdown protection when matching plain text. */
  protectMarkdown?: boolean
}

interface TrieNode {
  children: Map<string, TrieNode>
  entry?: VocabularyLexiconEntry
  normalized?: string
}

interface NormalizedText {
  characters: string[]
  spans: VocabularySpan[]
}

interface Candidate {
  endIndex: number
  start: number
  end: number
  entry: VocabularyLexiconEntry
  normalized: string
}

const LATIN_LETTER = /[A-Za-z]/u
const LETTER = /\p{L}/u
const LATIN_SCRIPT = /\p{Script=Latin}/u
const WORD_CHARACTER = /[\p{L}\p{N}_]/u
const WHITESPACE = /^\s$/u

/** Match the same normalization contract used by the build script. */
export function normalizeVocabularyTerm(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase()
}

function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareEntries(left: VocabularyLexiconEntry, right: VocabularyLexiconEntry): number {
  const lengthDifference = right.normalized.length - left.normalized.length
  if (lengthDifference !== 0) return lengthDifference
  const kindDifference = (right.kind === "expression" ? 1 : 0) - (left.kind === "expression" ? 1 : 0)
  if (kindDifference !== 0) return kindDifference
  const normalizedDifference = compareText(left.normalized, right.normalized)
  if (normalizedDifference !== 0) return normalizedDifference
  return compareText(left.display, right.display)
}

function validEntry(entry: VocabularyLexiconEntry): VocabularyLexiconEntry | null {
  const normalized = normalizeVocabularyTerm(entry.normalized || entry.display)
  const letters = Array.from(normalized).filter((character) => LETTER.test(character))
  if (!normalized || !LATIN_LETTER.test(normalized) || letters.some((character) => !LATIN_SCRIPT.test(character))) return null
  return normalized === entry.normalized ? entry : { ...entry, normalized }
}

function buildTrie(entries: readonly VocabularyLexiconEntry[]): TrieNode {
  const root: TrieNode = { children: new Map() }
  const chosen = new Map<string, VocabularyLexiconEntry>()

  for (const candidate of entries) {
    const entry = validEntry(candidate)
    if (!entry) continue
    const existing = chosen.get(entry.normalized)
    if (!existing || compareEntries(entry, existing) < 0) chosen.set(entry.normalized, entry)
  }

  for (const entry of [...chosen.values()].sort(compareEntries)) {
    let node = root
    for (const character of Array.from(entry.normalized)) {
      let child = node.children.get(character)
      if (!child) {
        child = { children: new Map() }
        node.children.set(character, child)
      }
      node = child
    }
    if (!node.entry || compareEntries(entry, node.entry) < 0) {
      node.entry = entry
      node.normalized = entry.normalized
    }
  }

  return root
}

function appendCharacter(view: NormalizedText, character: string, span: VocabularySpan): void {
  const parts = Array.from(character)
  for (const part of parts) {
    if (WHITESPACE.test(part)) {
      const previousIndex = view.characters.length - 1
      if (view.characters[previousIndex] === " ") {
        const previousSpan = view.spans[previousIndex]
        if (previousSpan) previousSpan.end = span.end
      } else {
        view.characters.push(" ")
        view.spans.push({ ...span })
      }
    } else {
      view.characters.push(part)
      view.spans.push({ ...span })
    }
  }
}

function normalizeWithSpans(source: string): NormalizedText {
  const view: NormalizedText = { characters: [], spans: [] }
  for (let offset = 0; offset < source.length; ) {
    const codePoint = source.codePointAt(offset)
    if (codePoint === undefined) break
    const raw = String.fromCodePoint(codePoint)
    const end = offset + raw.length
    appendCharacter(view, raw.normalize("NFKC").toLowerCase(), { start: offset, end })
    offset = end
  }
  return view
}

function isProtected(spans: readonly VocabularySpan[], start: number, end: number): boolean {
  return spans.some((span) => start < span.end && end > span.start)
}

function hasWordBoundary(source: string, start: number, end: number, normalized: string): boolean {
  const first = Array.from(normalized).find((character) => WORD_CHARACTER.test(character))
  const lastCharacters = Array.from(normalized).reverse()
  const last = lastCharacters.find((character) => WORD_CHARACTER.test(character))

  const previous = start > 0 ? Array.from(source.slice(0, start)).at(-1) : undefined
  const next = end < source.length ? Array.from(source.slice(end))[0] : undefined
  if (first && previous && WORD_CHARACTER.test(previous)) return false
  if (last && next && WORD_CHARACTER.test(next)) return false
  return true
}

function findCandidate(
  source: string,
  view: NormalizedText,
  root: TrieNode,
  index: number,
  protectedSpans: readonly VocabularySpan[],
): Candidate | null {
  const start = view.spans[index]?.start
  if (start === undefined) return null

  let node = root
  let best: Candidate | null = null
  for (let cursor = index; cursor < view.characters.length; cursor += 1) {
    const character = view.characters[cursor]
    const child = node.children.get(character)
    if (!child) break
    node = child
    if (!node.entry) continue

    const end = view.spans[cursor]?.end
    if (end === undefined || isProtected(protectedSpans, start, end)) continue
    const normalized = node.normalized ?? node.entry.normalized
    if (!hasWordBoundary(source, start, end, normalized)) continue
    best = {
      endIndex: cursor + 1,
      start,
      end,
      entry: node.entry,
      normalized,
    }
  }
  return best
}

function unmatchedToken(source: string, start: number, end: number): VocabularyToken | null {
  if (end <= start) return null
  return {
    start,
    end,
    text: source.slice(start, end),
    normalized: null,
    term: null,
    kind: null,
    entry: null,
  }
}

function matchedToken(source: string, candidate: Candidate): VocabularyToken {
  return {
    start: candidate.start,
    end: candidate.end,
    text: source.slice(candidate.start, candidate.end),
    normalized: candidate.normalized,
    term: candidate.normalized,
    kind: candidate.entry.kind,
    entry: candidate.entry,
  }
}

function pushUnmatched(tokens: VocabularyToken[], source: string, start: number, end: number): void {
  const token = unmatchedToken(source, start, end)
  if (!token) return
  const previous = tokens[tokens.length - 1]
  if (previous && previous.term === null && previous.end === token.start) {
    previous.end = token.end
    previous.text += token.text
  } else {
    tokens.push(token)
  }
}

/**
 * Tokenize text with longest-match-first, non-overlapping vocabulary matches.
 * The generated lexicon is the default, while tests and other callers may
 * inject a smaller entry set.
 */
export function createVocabularyMatcher(
  entries: readonly VocabularyLexiconEntry[] = vocabularyLexicon,
  options: VocabularyMatcherOptions = {},
): (text: string) => VocabularyToken[] {
  const root = buildTrie(entries)

  return (text: string): VocabularyToken[] => {
    if (!text) return []
    const view = normalizeWithSpans(text)
    const protectedSpans = options.protectedSpans
      ? mergeSpans(options.protectedSpans)
      : options.protectMarkdown === false
        ? []
        : findProtectedSpans(text)
    const tokens: VocabularyToken[] = []
    let normalizedIndex = 0
    let unmatchedStart = 0

    while (normalizedIndex < view.characters.length) {
      const sourceStart = view.spans[normalizedIndex]?.start
      if (sourceStart !== undefined && sourceStart < unmatchedStart) {
        normalizedIndex += 1
        continue
      }
      const candidate = findCandidate(text, view, root, normalizedIndex, protectedSpans)
      if (!candidate) {
        normalizedIndex += 1
        continue
      }

      pushUnmatched(tokens, text, unmatchedStart, candidate.start)
      tokens.push(matchedToken(text, candidate))
      unmatchedStart = candidate.end
      normalizedIndex = candidate.endIndex
      while (normalizedIndex < view.characters.length && (view.spans[normalizedIndex]?.start ?? text.length) < candidate.end) {
        normalizedIndex += 1
      }
    }
    pushUnmatched(tokens, text, unmatchedStart, text.length)
    return tokens
  }
}

export function tokenizeVocabulary(
  text: string,
  entries: readonly VocabularyLexiconEntry[] = vocabularyLexicon,
  options: VocabularyMatcherOptions = {},
): VocabularyToken[] {
  return createVocabularyMatcher(entries, options)(text)
}

function fenceSpans(markdown: string): VocabularySpan[] {
  const spans: VocabularySpan[] = []
  let offset = 0
  let open: { start: number; marker: string; length: number } | null = null
  const lines = markdown.match(/.*(?:\r?\n|$)/gu) ?? []

  for (const line of lines) {
    const content = line.replace(/\r?\n$/u, "")
    const opening = content.match(/^ {0,3}(`{3,}|~{3,})/u)
    if (!open && opening) {
      open = { start: offset, marker: opening[1][0], length: opening[1].length }
    } else if (open) {
      const closing = new RegExp(`^ {0,3}${open.marker}{${open.length},}[ \\t]*$`, "u")
      if (closing.test(content)) {
        spans.push({ start: open.start, end: offset + line.length })
        open = null
      }
    }
    offset += line.length
  }
  if (open) spans.push({ start: open.start, end: markdown.length })
  return spans
}

function inlineCodeSpans(markdown: string, excluded: readonly VocabularySpan[]): VocabularySpan[] {
  const spans: VocabularySpan[] = []
  const code = /(`+)([\s\S]*?)\1/gu
  for (const match of markdown.matchAll(code)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (!isProtected(excluded, start, end)) spans.push({ start, end })
  }
  return spans
}

function linkDestinationSpans(markdown: string): VocabularySpan[] {
  const spans: VocabularySpan[] = []
  const links = /!?\[[^\]\r\n]*\]\(\s*(?:<[^>\r\n]*>|[^)\r\n]*)\)/gu
  for (const match of markdown.matchAll(links)) {
    const start = match.index ?? 0
    spans.push({ start, end: start + match[0].length })
  }
  return spans
}

function mergeSpans(spans: readonly VocabularySpan[]): VocabularySpan[] {
  const sorted = spans
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .map((span) => ({ start: Math.max(0, span.start), end: Math.max(0, span.end) }))
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: VocabularySpan[] = []
  for (const span of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end)
    else merged.push(span)
  }
  return merged
}

/** Return fenced/inline code and Markdown link-destination ranges. */
export function findProtectedSpans(markdown: string): VocabularySpan[] {
  const fences = fenceSpans(markdown)
  return mergeSpans([
    ...fences,
    ...inlineCodeSpans(markdown, fences),
    ...linkDestinationSpans(markdown),
  ])
}
