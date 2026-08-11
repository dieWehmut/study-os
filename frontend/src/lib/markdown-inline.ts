/**
 * Inline markdown -> the words it was written to show.
 *
 * The map draws labels as SVG text, which has no emphasis to render into. So
 * `**内核 kernel**` reaches the reader as four literal asterisks around the term
 * -- the right words, the wrong form, and the same defect `liftImage` already
 * fixes for pictures. 2489 labels in the sample corpus carry bold and 1576
 * carry code spans, so this is the common case rather than an edge one.
 *
 * Stripped at draw time, never in the model. `MindNode.label` stays the source
 * text because a rename seeds its editor from it: strip there and the first
 * save would write the flattened words back and delete the author's emphasis
 * from the document.
 */

/**
 * Emphasis, per the one rule that separates it from arithmetic.
 *
 * A delimiter only opens if what follows it is not a space, and only closes if
 * what precedes it is not one -- which is CommonMark's left/right-flanking rule
 * in the small. Without it `背景 * 形状框 * 模板` reads as emphasis and the map
 * silently deletes the operators out of a formula. Longest delimiter first, so
 * `**a**` is never seen as two `*a*`.
 *
 * Whitespace is only half of it. `3*4*5` has no spaces to flank, and CommonMark
 * genuinely reads it as emphasis -- word-internal emphasis is legal for `*`. On
 * a 数学 card it is multiplication, and eating the operators draws `345`: not
 * noise the reader can see through, a different number. So `*` gets the same
 * neighbour test `_` already had, and for the same reason -- a delimiter pressed
 * against a letter or a digit belongs to an expression, not to emphasis.
 *
 * Latin and digits only, deliberately. Nobody multiplies 汉字, so guarding on
 * CJK would refuse 「写得很*重要*的」 -- the one form Chinese emphasis takes, since
 * it is written without spaces -- to protect an expression that cannot occur.
 *
 * Each carries its own replacement because the patterns that look behind at the
 * character before them must put that character back -- otherwise `a _b_ c`
 * comes out having lost a space.
 */
const emphasis: Array<[RegExp, string]> = [
  [/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1"],
  [/__(?=\S)([\s\S]*?\S)__/g, "$1"],
  [/~~(?=\S)([\s\S]*?\S)~~/g, "$1"],
  [/(^|[^\w])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1$2"],
  // Word-internal underscores are snake_case, not emphasis -- markdown agrees.
  [/(^|[^\w\u4e00-\u9fff])_(?=\S)([^_]*?\S)_(?![\w\u4e00-\u9fff])/g, "$1$2"],
]

export function plainInline(text: string): string {
  if (!text) return text

  // Images before links: the two differ by one leading "!", and the link
  // pattern would otherwise strip the address and strand the "!" on the alt.
  let out = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")

  // Code spans keep their contents: a span is quoting an identifier, and the
  // identifier is the thing worth reading. Only the fence around it goes.
  out = out.replace(/`+([^`]+)`+/g, "$1")

  // Twice, so one level of nesting comes out whole. `**很*重要*的**` would
  // otherwise keep the inner pair, which is worse than leaving both: it reads
  // as a typo rather than as markup.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [pattern, replacement] of emphasis) out = out.replace(pattern, replacement)
  }

  return out
}
