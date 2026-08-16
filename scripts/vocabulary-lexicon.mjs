/**
 * Deterministic helpers for turning the ignored Obsidian vocabulary indexes
 * into the small data file consumed by the frontend.
 */

const WORD_LINK_PREFIX = "word-wiki/"
const LINK_PATTERN = /\[\[([^\]\r\n]*)\]\]/g
const A_TO_Z_HEADING = /^##\s+A[\u2013\u2014-]Z(?:\s|$)/iu
const SECTION_HEADING = /^##\s+/u
const BULLET_LINK = /^\s*[-*+]\s+\[\[/u
const LATIN_LETTER = /\p{Script=Latin}/u
const LETTER = /\p{L}/u
const HAN_LETTER = /\p{Script=Han}/u

/** @typedef {"word" | "expression"} VocabularyKind */

/**
 * Normalize a term for matching and deterministic identity.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeTerm(value) {
  if (typeof value !== "string") return ""
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase()
}

/**
 * Keep casing and punctuation for the human-facing label while applying the
 * same Unicode and whitespace normalization as the lookup key.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeDisplay(value) {
  if (typeof value !== "string") return ""
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ")
}

/**
 * English entries may contain punctuation used by the source notes (for
 * example `a.m.`, `one's`, or `(great/large)`), but must not contain CJK or
 * markup-only labels such as navigation links.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isValidTerm(value) {
  const normalized = normalizeTerm(value)
  if (!normalized || normalized.length > 240) return false
  if (/[[\]{}<>\r\n]/u.test(normalized)) return false
  if ([...normalized].some((character) => /\p{C}/u.test(character))) return false

  const letters = [...normalized].filter((character) => LETTER.test(character))
  if (letters.length === 0 || !letters.some((character) => LATIN_LETTER.test(character))) return false
  if (letters.some((character) => HAN_LETTER.test(character) || !LATIN_LETTER.test(character))) return false
  return true
}

/**
 * Split one Obsidian link body into target and optional display alias.
 *
 * @param {string} body
 * @returns {{ target: string, label: string, hasAlias: boolean }}
 */
function splitWikiLink(body) {
  const separator = body.indexOf("|")
  if (separator < 0) {
    const target = body.trim()
    return { target, label: target, hasAlias: false }
  }

  return {
    target: body.slice(0, separator).trim(),
    label: body.slice(separator + 1).trim(),
    hasAlias: true,
  }
}

/**
 * Read wiki links with line information. The line is useful when a developer
 * runs the generator against a malformed local source.
 *
 * @param {string} markdown
 * @param {{ sourceName?: string, strict?: boolean }} [options]
 * @returns {Array<{ body: string, start: number, end: number, line: number, lineText: string }>}
 */
export function parseWikiLinks(markdown, options = {}) {
  const source = typeof markdown === "string" ? markdown : ""
  const links = []
  const matchedRanges = []

  for (const match of source.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const line = source.slice(0, start).split(/\r?\n/u).length
    const lineStart = source.lastIndexOf("\n", start - 1) + 1
    const lineEnd = source.indexOf("\n", end)
    links.push({
      body: match[1] ?? "",
      start,
      end,
      line,
      lineText: source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd),
    })
    matchedRanges.push([start, end])
  }

  if (options.strict) {
    const opening = /\[\[/gu
    for (const match of source.matchAll(opening)) {
      const start = match.index ?? 0
      if (matchedRanges.some(([rangeStart, rangeEnd]) => start >= rangeStart && start < rangeEnd)) continue
      const line = source.slice(0, start).split(/\r?\n/u).length
      const sourceName = options.sourceName ?? "markdown"
      throw new Error(`${sourceName}:${line}: malformed wiki link`)
    }
  }

  return links
}

/**
 * Return the text following a link when it is an explicit human-readable
 * meaning. Category code spans and count annotations are intentionally not
 * treated as meanings.
 *
 * @param {string} lineText
 * @param {number} linkEnd
 * @returns {string | undefined}
 */
function extractMeaning(lineText, linkEnd) {
  let rest = lineText.slice(linkEnd).trim()
  if (!rest) return undefined
  rest = rest.replace(/`[^`]*`/gu, "").trim()
  const match = rest.match(/^(?:\u2014|\u2013|--|:)\s*(.+)$/u)
  if (!match) return undefined
  const meaning = normalizeDisplay(match[1])
  if (!meaning || /^\d+\s*[^A-Za-z]*$/u.test(meaning)) return undefined
  return meaning
}

/**
 * Select expression links from the A-Z section. For small inline fixtures
 * without a section heading, bullet links are accepted anywhere; this keeps
 * the helper convenient to test while still excluding the real file's
 * grammar-family and navigation links.
 *
 * @param {string} markdown
 * @param {ReturnType<typeof parseWikiLinks>} links
 * @returns {ReturnType<typeof parseWikiLinks>}
 */
function expressionLinks(markdown, links) {
  const lines = markdown.split(/\r?\n/u)
  const azLineNumbers = lines
    .map((line, index) => (A_TO_Z_HEADING.test(line) ? index + 1 : -1))
    .filter((index) => index >= 0)
  const hasAzSection = azLineNumbers.length > 0
  const firstAzLine = azLineNumbers[0] ?? 0

  return links.filter((link) => {
    const lineText = link.lineText
    if (!hasAzSection) return BULLET_LINK.test(lineText) || /^\s*\[\[/u.test(lineText)
    if (!BULLET_LINK.test(lineText)) return false
    if (link.line <= firstAzLine) return false

    for (const lineNumber of azLineNumbers) {
      if (link.line <= lineNumber) continue
      let sectionEnd = lines.length + 1
      for (let index = lineNumber; index < lines.length; index += 1) {
        if (index + 1 > lineNumber && SECTION_HEADING.test(lines[index] ?? "")) {
          sectionEnd = index + 1
          break
        }
      }
      if (link.line > lineNumber && link.line < sectionEnd) return true
    }
    return false
  })
}

/**
 * Attach optional metadata without changing the compact shape for ordinary
 * entries. The serializer still sees the property when it is present.
 *
 * @param {{ normalized: string, display: string, kind: VocabularyKind }} entry
 * @param {string | undefined} meaning
 */
function withMeaning(entry, meaning) {
  if (meaning) {
    Object.defineProperty(entry, "meaning", {
      configurable: true,
      enumerable: true,
      value: meaning,
      writable: true,
    })
  }
  return entry
}

/**
 * Extract normalized vocabulary entries from one reference file.
 *
 * @param {string} markdown
 * @param {VocabularyKind} kind
 * @param {{ sourceName?: string, strict?: boolean }} [options]
 * @returns {Array<{ normalized: string, display: string, kind: VocabularyKind, meaning?: string }>}
 */
export function extractEntries(markdown, kind, options = {}) {
  if (kind !== "word" && kind !== "expression") return []
  const source = typeof markdown === "string" ? markdown : ""
  if (!source) return []

  const links = parseWikiLinks(source, options)
  const candidates = kind === "expression"
    ? expressionLinks(source, links)
    : links.filter((link) => splitWikiLink(link.body).target.toLowerCase().startsWith(WORD_LINK_PREFIX))

  const entries = []
  const byKey = new Map()
  for (const link of candidates) {
    const { target, label, hasAlias } = splitWikiLink(link.body)
    if (!target) continue

    let display = normalizeDisplay(hasAlias ? label : target)
    if (kind === "word") {
      if (!target.toLowerCase().startsWith(WORD_LINK_PREFIX)) continue
      if (!hasAlias) display = normalizeDisplay(target.slice(WORD_LINK_PREFIX.length).split("/").pop())
      if (hasAlias && !display) continue
    }
    if (!display || !isValidTerm(display)) continue

    const normalized = normalizeTerm(display)
    if (!normalized || !isValidTerm(normalized)) continue
    const linkStartInLine = link.lineText.indexOf("[[")
    const closeInLine = linkStartInLine < 0 ? -1 : link.lineText.indexOf("]]", linkStartInLine + 2)
    const meaning = closeInLine < 0 ? undefined : extractMeaning(link.lineText, closeInLine + 2)
    const entry = withMeaning({ normalized, display, kind }, meaning)
    const key = `${kind}\u0000${normalized}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, entry)
      entries.push(entry)
      continue
    }

    if (entry.meaning && (!existing.meaning || compareText(entry.meaning, existing.meaning) < 0)) {
      existing.meaning = entry.meaning
    }
    if (compareText(entry.display, existing.display) < 0) existing.display = entry.display
  }

  return entries
}

/**
 * Normalize, deduplicate, and deterministically order entries from any number
 * of source files. Expressions win a collision with a single word.
 *
 * @param {Iterable<unknown>} entries
 * @returns {Array<{ normalized: string, display: string, kind: VocabularyKind, meaning?: string }>}
 */
export function dedupeEntries(entries) {
  const byTerm = new Map()
  for (const raw of entries ?? []) {
    if (!raw || typeof raw !== "object") continue
    const value = /** @type {Record<string, unknown>} */ (raw)
    const kind = value.kind === "expression" ? "expression" : value.kind === "word" ? "word" : null
    if (!kind) continue
    const display = normalizeDisplay(value.display ?? value.normalized)
    const normalized = normalizeTerm(value.normalized ?? display)
    if (!display || !normalized || !isValidTerm(normalized)) continue

    const candidate = {
      normalized,
      display,
      kind,
      ...(typeof value.meaning === "string" && normalizeDisplay(value.meaning)
        ? { meaning: normalizeDisplay(value.meaning) }
        : {}),
    }
    const existing = byTerm.get(normalized)
    if (!existing) {
      byTerm.set(normalized, candidate)
      continue
    }

    const candidatePriority = kind === "expression" ? 1 : 0
    const existingPriority = existing.kind === "expression" ? 1 : 0
    if (
      candidatePriority > existingPriority
      || (candidatePriority === existingPriority && compareText(candidate.display, existing.display) < 0)
    ) {
      if (!candidate.meaning && existing.meaning) candidate.meaning = existing.meaning
      if (candidate.meaning && existing.meaning && compareText(existing.meaning, candidate.meaning) < 0) {
        candidate.meaning = existing.meaning
      }
      byTerm.set(normalized, candidate)
      continue
    }
    if (candidate.meaning && (!existing.meaning || compareText(candidate.meaning, existing.meaning) < 0)) {
      existing.meaning = candidate.meaning
    }
  }

  return [...byTerm.values()].sort(compareEntries)
}

function compareText(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareEntries(left, right) {
  const lengthDifference = right.normalized.length - left.normalized.length
  if (lengthDifference !== 0) return lengthDifference
  const kindDifference = (right.kind === "expression" ? 1 : 0) - (left.kind === "expression" ? 1 : 0)
  if (kindDifference !== 0) return kindDifference
  const normalizedDifference = compareText(left.normalized, right.normalized)
  if (normalizedDifference !== 0) return normalizedDifference
  return compareText(left.display, right.display)
}

function escapeAscii(value) {
  const json = JSON.stringify(value)
  let escaped = ""
  for (let index = 0; index < json.length; index += 1) {
    const character = json[index]
    const code = character.charCodeAt(0)
    escaped += code > 0x7f ? `\\u${code.toString(16).padStart(4, "0")}` : character
  }
  return escaped
}

/**
 * Serialize entries as a stable, ASCII-only TypeScript module.
 *
 * @param {Iterable<unknown>} entries
 * @returns {string}
 */
export function serializeLexicon(entries) {
  const normalizedEntries = dedupeEntries(entries)
  const hasMeaning = normalizedEntries.some((entry) => entry.meaning)
  const lines = [
    "// Generated by scripts/build-vocabulary-lexicon.mjs. Do not edit.",
    "",
    "export interface VocabularyLexiconEntry {",
    "  normalized: string",
    "  display: string",
    '  kind: "word" | "expression"',
    ...(hasMeaning ? ["  meaning?: string"] : []),
    "}",
    "",
    "export const vocabularyLexicon: readonly VocabularyLexiconEntry[] = [",
  ]

  for (const entry of normalizedEntries) {
    const fields = [
      `normalized: ${escapeAscii(entry.normalized)}`,
      `display: ${escapeAscii(entry.display)}`,
      `kind: ${escapeAscii(entry.kind)}`,
      ...(entry.meaning ? [`meaning: ${escapeAscii(entry.meaning)}`] : []),
    ]
    lines.push(`  { ${fields.join(", ")} },`)
  }
  lines.push("] as const", "")
  return lines.join("\n")
}
