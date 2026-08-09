/**
 * Cuts a passage into pieces a text-to-speech engine can be asked for one at a
 * time, so playback starts after the first piece instead of after the whole
 * passage.
 */

/**
 * Long enough that synthesis, not scheduling, dominates a request. One sentence
 * per request would spend most of the wall clock on round trips, and every seam
 * is a place where the voice's prosody restarts from nothing -- so a piece wants
 * to be as long as the wait for the first one allows, not as short as possible.
 */
const defaultMinChars = 60

const chineseStops = new Set(["。", "！", "？", "；"])
const asciiStops = new Set([".", "!", "?", ";"])

/** Closing marks end the sentence they follow; cutting before one would open the
 * next request with a stray bracket. */
const trailers = new Set(["”", "’", "」", "』", "）", "】", "》", ")", "\"", "'"])

/** Words whose trailing dot is part of the word. Short on purpose: each entry is
 * a place where a real sentence end would be missed. */
const abbreviations = new Set(["no", "nos", "mr", "mrs", "ms", "dr", "prof", "vs", "etc", "fig", "eq", "al", "approx"])

/**
 * Returns the index just past the LaTeX span opening at `open`, or `open` when
 * there is none. A dot inside maths is notation -- `$f(x) = 1. y$` is one
 * sentence, and cutting it would hand the engine half a formula.
 */
function mathSpanEnd(text: string, open: number): number {
  // An escaped dollar is a literal one, so it opens nothing.
  if (text[open - 1] === "\\") return open
  const marker = text.startsWith("$$", open) ? "$$" : "$"
  const close = text.indexOf(marker, open + marker.length)
  if (close === -1) return open
  // Inline maths never runs past a blank line, so a lone dollar (a price) must
  // not swallow the rest of the paragraph looking for its partner.
  if (marker === "$" && text.slice(open, close).includes("\n")) return open
  return close + marker.length
}

/**
 * Returns the index just past the inline code span opening at `open`, or
 * `open` when there is none.
 *
 * A "$" inside code is a literal character, not a maths delimiter. Without
 * this, `` `$` `` (a code span holding one dollar sign, as in "use `$` as a
 * delimiter") was itself read as the *opening* of a maths span, and the
 * scanner went hunting for its "close" -- which it found in the next real
 * formula, tearing that formula in half and reading half of it as code.
 */
function codeSpanEnd(text: string, open: number): number {
  const close = text.indexOf("`", open + 1)
  if (close === -1) return open
  // Same reasoning as the lone-dollar guard below: an inline span never spans
  // a blank line, so an unmatched backtick must not swallow the rest of the
  // document hunting for a partner that is not coming.
  if (text.slice(open, close).includes("\n")) return open
  return close + 1
}

/**
 * `start` is the stop, `end` is just past the run of stops and closing marks
 * around it.
 */
function endsSentence(text: string, start: number, end: number): boolean {
  // Chinese prose puts no space between sentences, so a full-width stop is a
  // boundary on its own.
  for (let i = start; i < end; i += 1) if (chineseStops.has(text[i])) return true

  const after = text[end]
  if (after !== undefined && !/\s/.test(after)) return false
  if (text[start] !== ".") return true

  // The rest is the dot's problem alone: it also marks decimals, initialisms and
  // abbreviations, so it only ends a sentence when nothing says otherwise.
  const before = text.slice(0, end)
  // "e.g." / "U.S." -- a dotted initialism, not a full stop.
  if (/(?:^|[\s(])(?:[A-Za-z]\.)+$/.test(before)) return false
  const word = /([A-Za-z]+)\.$/.exec(before)?.[1]
  if (word && abbreviations.has(word.toLowerCase())) return false
  // Nothing starts a sentence with a digit or a lowercase letter, so "No. 7"
  // and "etc. and so on" stay whole even when the word list misses them.
  const following = /\S/.exec(text.slice(end))?.[0]
  return following === undefined || !/[a-z0-9]/.test(following)
}

/**
 * Splits `text` on sentence ends, then merges neighbours until each piece holds
 * at least `minChars` characters. Never returns an empty or blank piece.
 */
export function splitSentences(text: string, minChars: number = defaultMinChars): string[] {
  const target = Math.max(1, minChars)
  const chunks: string[] = []
  let pending = ""

  function take(fragment: string) {
    pending += fragment
    if (pending.trim().length < target) return
    chunks.push(pending.trim())
    pending = ""
  }

  let start = 0
  let i = 0
  while (i < text.length) {
    // Checked before "$": a code span has to be skipped whole, so a dollar
    // sign living inside one is never mistaken for the start of a formula.
    if (text[i] === "`") {
      const span = codeSpanEnd(text, i)
      if (span > i) {
        i = span
        continue
      }
    }
    if (text[i] === "$") {
      const span = mathSpanEnd(text, i)
      if (span > i) {
        i = span
        continue
      }
    }
    if (!chineseStops.has(text[i]) && !asciiStops.has(text[i])) {
      i += 1
      continue
    }
    // "?!" and "。」" close one sentence, not one each.
    let end = i + 1
    while (end < text.length && (chineseStops.has(text[end]) || asciiStops.has(text[end]) || trailers.has(text[end]))) {
      end += 1
    }
    if (endsSentence(text, i, end)) {
      take(text.slice(start, end))
      start = end
    }
    i = end
  }
  take(text.slice(start))

  if (pending.trim()) {
    // A leftover stub would cost a whole request for a few words and add a seam
    // the voice restarts from, so it rides along with the piece before it.
    if (chunks.length > 0) chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}${pending}`.trim()
    else chunks.push(pending.trim())
  }
  return chunks
}
