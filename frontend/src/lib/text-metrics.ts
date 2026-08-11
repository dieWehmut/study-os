/**
 * How wide text draws, without a browser to ask.
 *
 * Canvas `measureText` is exact and unavailable: jsdom has no layout engine, so
 * `getBoundingClientRect()` answers 0 for everything. That is not a testing
 * inconvenience -- it decides the architecture. The one thing these cards must
 * get right is that nothing overflows, and a layout only the browser can
 * compute is a layout no test can check. So the width is arithmetic here, and
 * the same arithmetic runs in the test and on the screen.
 *
 * The table is from sample/distill/skill/knowledge-card/SKILL.md, which had to
 * do this by hand for the same reason.
 */

/** CJK, kana, and the fullwidth forms: all one em. */
const fullWidth = /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f\u3040-\u30ff]/
/** The wide latin letters and the arrows drawn at letter size. */
const wide = /[mwMW→⇌⇄↔]/
/** The ones that are barely more than a stroke. */
const narrow = /[iljItf1.,;:'`|!\][()]/

/** Fractions of the font size. Anything unlisted is ordinary latin or a digit. */
const emWide = 0.9
const emNarrow = 0.3
const emDefault = 0.55

/** One character's advance, in fractions of an em. */
function advance(character: string): number {
  if (fullWidth.test(character)) return 1
  if (wide.test(character)) return emWide
  if (narrow.test(character)) return emNarrow
  return emDefault
}

/** How wide this string draws at this font size, in px. */
export function measure(text: string, fontSize: number): number {
  let total = 0
  for (const character of text) total += advance(character)
  return total * fontSize
}

/**
 * Break a latin run that is wider than a whole line.
 *
 * Only as a last resort. A word cut in half is a word destroyed, but a word
 * left whole is a word hanging past the card's right edge -- and these cards
 * have no clipping path by design, so an overflow is not hidden, it is drawn
 * over whatever is next to it.
 */
function breakLongWord(word: string, fontSize: number, maxWidth: number): string[] {
  const pieces: string[] = []
  let current = ""
  for (const character of word) {
    if (current && measure(current + character, fontSize) > maxWidth) {
      pieces.push(current)
      current = ""
    }
    current += character
  }
  if (current) pieces.push(current)
  return pieces
}

/**
 * Split text into lines that each fit inside `maxWidth`.
 *
 * Two different jobs, because two different scripts. CJK has no word
 * boundaries and breaks anywhere, so it is measured character by character.
 * Latin does have boundaries and the author already marked them with spaces;
 * breaking mid-word there turns "photosynthesis" into two things that are not
 * words. So a latin run is kept whole and moved to the next line, unless it
 * cannot fit on a line at all.
 */
export function wrap(text: string, fontSize: number, maxWidth: number): string[] {
  // A latin run is any stretch of non-CJK non-space; everything else is taken
  // one character at a time.
  const tokens = text.match(/[^\s]+|\s+/g) ?? []
  const lines: string[] = []
  let line = ""

  // A space that ends a line is the break itself, not text. Kept, it draws as
  // trailing whitespace that widens the line past what the caller budgeted --
  // and for a centred label it shifts every glyph left of centre.
  const flush = () => {
    lines.push(line.trimEnd())
    line = ""
  }

  const push = (piece: string) => {
    if (line && measure(line + piece, fontSize) > maxWidth) flush()
    // Same reason at the other end: a break's own space must not open the next
    // line by indenting it.
    if (!line && piece.trim() === "") return
    line += piece
  }

  for (const token of tokens) {
    if (token.trim() === "") {
      push(token)
      continue
    }
    if (fullWidth.test(token)) {
      for (const character of token) push(character)
      continue
    }
    if (measure(token, fontSize) > maxWidth) {
      for (const piece of breakLongWord(token, fontSize, maxWidth)) {
        if (line) flush()
        line = piece
        if (measure(line, fontSize) >= maxWidth) flush()
      }
      continue
    }
    push(token)
  }

  if (line) flush()
  return lines.length > 0 ? lines : [""]
}
