package speechtext

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// latexRules turns LaTeX into ordinary notation -- "\alpha" into "α", "\times"
// into "×" -- and stops there. It deliberately does not go all the way to
// words: the chemistry, physics and maths stages that run after it already own
// tables for "×", "α" and "∫", and teaching them to also read backslash
// commands would mean maintaining every one of those tables twice. Chinese is
// produced here only where ordinary notation has nothing to offer, as with
// "\frac{a}{b}" -> "b分之a", which no later rule can express.
//
// All of it hangs off a single rule because LaTeX nests and nesting is the one
// thing a regexp cannot see: "\frac{\frac{a}{b}}{c}" needs something that
// counts braces, and RE2 has no recursion and no backreferences. The Pattern
// below is therefore only a cheap trigger -- it matches from the first
// character that could open a maths span through to the end of the text -- and
// rewriteLatex does the real work by scanning. Prose containing no "$", no
// backtick and no backslash delimiter never matches at all, so the common case
// costs one failed search.
func latexRules() []Rule {
	return []Rule{
		{
			Name:    "latex-math-spans",
			Pattern: latexTrigger,
			Expand:  func(groups []string) string { return rewriteLatex(groups[0]) },
		},
	}
}

// latexTrigger is written as "\x60" rather than a literal backtick because a Go
// raw string literal cannot contain one. Backticks are in the alternation so
// that scanning starts at a code span rather than inside it -- see codeSpan.
var latexTrigger = regexp.MustCompile(`(?s)(?:\$|\x60|\\[\[(]|\\begin\{).*`)

// rewriteLatex copies text through byte for byte, replacing only the maths
// spans it can positively identify. Everything outside a span is left exactly
// as it was found, and that is the rule that protects the rest of the vault: a
// Windows path such as C:\Users\name is full of things that look like LaTeX
// commands, so commands are only ever interpreted between delimiters that the
// author wrote on purpose.
func rewriteLatex(text string) string {
	var builder strings.Builder
	index := 0
	for index < len(text) {
		rest := text[index:]

		if rest[0] == '`' {
			literal, next := codeSpan(text, index)
			builder.WriteString(literal)
			index = next
			continue
		}
		// An escaped dollar is a currency sign the author took the trouble to
		// protect, so it is never a delimiter.
		if strings.HasPrefix(rest, `\$`) {
			builder.WriteString(`\$`)
			index += 2
			continue
		}
		if body, next, ok := delimitedSpan(text, index, `\(`, `\)`); ok {
			builder.WriteString(spokenMath(body))
			index = next
			continue
		}
		if body, next, ok := delimitedSpan(text, index, `\[`, `\]`); ok {
			builder.WriteString(spokenMath(body))
			index = next
			continue
		}
		if body, next, ok := environmentSpan(text, index); ok {
			builder.WriteString(spokenMath(body))
			index = next
			continue
		}
		// Display maths is unambiguous: "$$" pairs with "$$" and nothing else
		// in prose looks like that, so it needs none of the guards below.
		if body, next, ok := delimitedSpan(text, index, "$$", "$$"); ok {
			builder.WriteString(spokenMath(body))
			index = next
			continue
		}
		if body, next, ok := inlineDollarSpan(text, index); ok {
			builder.WriteString(spokenMath(body))
			index = next
			continue
		}

		builder.WriteByte(text[index])
		index++
	}
	return builder.String()
}

// inlineDollarSpan decides whether the dollar at index opens inline maths.
//
// This is the one genuinely dangerous judgement in the file, because a single
// dollar is also how money is written, and two prices in one sentence look
// exactly like a maths span: in 「价格 $9.99 和 $12.50」 a naive matcher pairs the
// two dollars, deletes both, and silently rewrites the numbers in between. The
// note is never modified, so the reader would never find out; only the listener
// would, and only by hearing nonsense.
//
// The test is Pandoc's, because it is well known, conservative, and was
// designed against exactly this corpus of prose-with-money:
//
//   - the opening dollar must be followed immediately by a non-space, so
//     "$ 100" is money;
//   - the closing dollar must be preceded immediately by a non-space, which is
//     what rejects the pairing in 「$9.99 和 $12.50」;
//   - the closing dollar must not be followed by a digit, which rejects "$5和$6"
//     where nothing else would;
//   - the span may not cross a line, since a dollar on one line and another on
//     the next is not one formula.
//
// A candidate that fails is not retried against a later dollar. Retrying would
// let one stray dollar swallow an arbitrary amount of prose, and the failure
// mode we are choosing against is precisely that.
func inlineDollarSpan(text string, index int) (string, int, bool) {
	if text[index] != '$' {
		return "", index, false
	}
	rest := text[index+1:]
	if rest == "" || isSpaceByte(rest[0]) {
		return "", index, false
	}
	for scan := 0; scan < len(rest); scan++ {
		switch {
		case rest[scan] == '\\':
			scan++ // An escaped dollar inside the span is not the closer.
		case rest[scan] == '\n':
			return "", index, false
		case rest[scan] == '$':
			if scan == 0 {
				return "", index, false // "$$" with nothing in it says nothing.
			}
			if isSpaceByte(rest[scan-1]) {
				return "", index, false
			}
			if scan+1 < len(rest) && isDigitByte(rest[scan+1]) {
				return "", index, false
			}
			return rest[:scan], index + scan + 2, true
		}
	}
	return "", index, false
}

// delimitedSpan matches a span whose opening and closing markers are fixed
// strings. An unterminated opener returns false and is then copied through as
// ordinary text, so "$x + 1" at the end of a paragraph survives intact.
func delimitedSpan(text string, index int, opening, closing string) (string, int, bool) {
	if !strings.HasPrefix(text[index:], opening) {
		return "", index, false
	}
	body := text[index+len(opening):]
	end := strings.Index(body, closing)
	if end < 0 {
		return "", index, false
	}
	return body[:end], index + len(opening) + end + len(closing), true
}

var latexEnvironmentOpener = regexp.MustCompile(`^\\begin\{([A-Za-z]+\*?)\}`)

// environmentSpan matches "\begin{align}...\end{align}" written outside any
// dollar signs, which is how longer derivations are usually pasted in. The
// returned body still carries its own begin and end markers; expandMath drops
// them, and letting it do so keeps one implementation for environments whether
// they arrive bare or wrapped in "$$".
func environmentSpan(text string, index int) (string, int, bool) {
	match := latexEnvironmentOpener.FindStringSubmatchIndex(text[index:])
	if match == nil {
		return "", index, false
	}
	name := text[index+match[2] : index+match[3]]
	opening, closing := `\begin{`+name+`}`, `\end{`+name+`}`

	// Depth counting, because a matrix can sit inside another matrix.
	depth := 1
	scan := index + match[1]
	for depth > 0 {
		nextClose := strings.Index(text[scan:], closing)
		if nextClose < 0 {
			return "", index, false
		}
		if nextOpen := strings.Index(text[scan:], opening); nextOpen >= 0 && nextOpen < nextClose {
			depth++
			scan += nextOpen + len(opening)
			continue
		}
		depth--
		scan += nextClose + len(closing)
	}
	return text[index:scan], scan, true
}

// codeSpan copies a Markdown code span or fenced block through untouched. A
// note that shows `$x$` as an example of syntax is documenting the syntax, not
// asking for it to be read aloud as maths. An unclosed run of backticks is
// treated as an ordinary character so that one stray tick cannot silence every
// formula after it.
func codeSpan(text string, index int) (string, int) {
	ticks := 0
	for index+ticks < len(text) && text[index+ticks] == '`' {
		ticks++
	}
	fence := strings.Repeat("`", ticks)
	end := strings.Index(text[index+ticks:], fence)
	if end < 0 {
		return text[index : index+ticks], index + ticks
	}
	stop := index + ticks + end + ticks
	for stop < len(text) && text[stop] == '`' {
		stop++
	}
	return text[index:stop], stop
}

var (
	latexBlankRun         = regexp.MustCompile(`[ \t\r\n]+`)
	latexSpaceBeforeComma = regexp.MustCompile(` +，`)
)

// spokenMath expands a span and tidies the result. Whitespace inside maths is
// meaningless to LaTeX itself -- it lays out "a b" as "ab" -- so collapsing runs
// of it here loses nothing, and it saves every rule below from having to care
// whether the author broke a display equation across five lines.
func spokenMath(body string) string {
	spoken := latexBlankRun.ReplaceAllString(expandMath(body), " ")
	spoken = latexSpaceBeforeComma.ReplaceAllString(spoken, "，")
	return strings.TrimSpace(spoken)
}

// expandMath is the recursive half: it walks one span's contents and calls
// itself for every braced group, which is what makes "\frac{\frac{a}{b}}{c}"
// come out in the right order. Every branch advances index, so malformed input
// terminates rather than spinning.
func expandMath(source string) string {
	var builder strings.Builder
	index := 0
	for index < len(source) {
		switch character := source[index]; {
		case character == '\\':
			spoken, next := latexCommand(source, index)
			builder.WriteString(spoken)
			index = next
		case character == '{':
			body, next := braceBody(source, index)
			builder.WriteString(expandMath(body))
			index = next
		case character == '}':
			// A closer with no opener. Braces are grouping, never sound.
			index++
		case character == '^' || character == '_':
			spoken, next := scriptRun(source, index)
			builder.WriteString(spoken)
			index = next
		case character == '&':
			// The alignment tab separates the two halves of one equation, so a
			// space is right here and a comma would not be: "x &= 1" is a
			// single clause.
			builder.WriteByte(' ')
			index++
		case character == '-':
			// The maths stage only knows the Unicode minus, so an ASCII hyphen
			// that survives is not mispronounced but dropped: "$a - b$" arrives
			// at the engine as "a b", and a listener has no way to tell that an
			// operator went missing. Converting it here is safe only because a
			// span boundary has already been established -- the same rewrite
			// applied to running prose would turn 2024-01-15, "20-30 页" and
			// every hyphenated word into subtractions, which is exactly why
			// this lives inside expandMath and not in a rule of its own.
			builder.WriteString("−")
			index++
		default:
			builder.WriteByte(character)
			index++
		}
	}
	return builder.String()
}

// latexCommand expands the command starting at index, which source[index]
// guarantees is a backslash.
func latexCommand(source string, index int) (string, int) {
	rest := source[index+1:]
	if rest == "" {
		return "", index + 1
	}
	if !isCommandLetter(rest[0]) {
		return controlSymbol(source, index)
	}
	end := 0
	for end < len(rest) && isCommandLetter(rest[end]) {
		end++
	}
	return controlWord(source, rest[:end], index+1+end)
}

// controlSymbol handles the one-character commands. Most of them are spacing,
// which is a typesetting instruction with no spoken form at all.
func controlSymbol(source string, index int) (string, int) {
	next := index + 2
	switch source[index+1] {
	case '\\':
		// A line break ends one line of a derivation. Speaking it as a comma is
		// what stops two equations from arriving as a single breathless
		// sentence. An optional "[6pt]" spacing argument follows it sometimes.
		return "，", skipOptionalArgument(source, next)
	case ',', ';', ':', ' ', '\n':
		return " ", next
	case '!':
		return "", next // Negative thin space: purely visual.
	case '{', '}':
		return "", next // A literal brace makes no sound.
	case '%', '#', '&', '$':
		return string(source[index+1]), next
	case '|':
		return "‖", next
	}
	// Any other escape is punctuation the author wanted printed, and printed
	// punctuation is not read aloud.
	return "", next
}

// controlWord expands a multi-letter command. index has already moved past the
// name, so every branch that takes no argument can return it unchanged.
func controlWord(source, name string, index int) (string, int) {
	switch name {
	case "frac", "dfrac", "tfrac", "cfrac":
		// Chinese names the denominator first: b分之a is "a over b". There is
		// no notation for this downstream, so the words are produced here.
		numerator, afterNumerator, ok := readArgument(source, index)
		if !ok {
			return "", index
		}
		denominator, afterDenominator, ok := readArgument(source, afterNumerator)
		if !ok {
			return expandMath(numerator), afterNumerator
		}
		return expandMath(denominator) + "分之" + expandMath(numerator), afterDenominator

	case "sqrt":
		degree := ""
		next := index
		if body, after, ok := readOptionalArgument(source, index); ok {
			degree = rootDegree(expandMath(body))
			next = after
		}
		radicand, after, ok := readArgument(source, next)
		if !ok {
			return degree + "根号", next
		}
		return degree + "根号" + expandMath(radicand), after

	case "lim", "limsup", "liminf":
		// The maths stage matches a bare "lim" with a word boundary on both
		// sides, so the subscript must not stay welded to it: "\lim_{x \to 0}"
		// has to leave here as "lim x → 0" or the limit is never recognised and
		// the listener hears three letters.
		next := skipSpaces(source, index)
		if next < len(source) && source[next] == '_' {
			if body, after, ok := readArgument(source, next+1); ok {
				return name + " " + expandMath(body), after
			}
		}
		return name, index

	case "left", "right":
		// The delimiter that follows is ordinary notation and stays; only the
		// sizing instruction goes. "\left." is a deliberately invisible
		// delimiter and leaves nothing behind.
		next := skipSpaces(source, index)
		if next < len(source) && source[next] == '.' {
			return "", next + 1
		}
		return "", index

	case "begin", "end":
		next := index
		environment := ""
		if body, after, ok := readArgument(source, next); ok {
			environment, next = body, after
		}
		// An array or a tabular carries a column specification -- "{ccc}" --
		// that is layout, not content, and would otherwise be read out.
		if name == "begin" && (environment == "array" || environment == "tabular" || environment == "subarray") {
			if _, after, ok := readArgument(source, next); ok {
				next = after
			}
		}
		return " ", next

	case "vec", "overrightarrow":
		// The arrow over a symbol has no ordinary-notation equivalent, and
		// dropping it makes a vector indistinguishable from its magnitude,
		// which is a physics error rather than a cosmetic one.
		body, after, ok := readArgument(source, index)
		if !ok {
			return "", index
		}
		return "向量" + expandMath(body), after

	case "quad", "qquad", "enspace", "thinspace", "medspace", "negthinspace":
		return " ", index

	case "hspace", "vspace", "phantom", "hphantom", "vphantom", "label":
		// These take an argument that is spacing or bookkeeping. Dropping the
		// command but keeping its argument would read a length aloud.
		if _, after, ok := readArgument(source, index); ok {
			return " ", after
		}
		return " ", index

	case "nonumber", "notag":
		// Bare flags, never followed by an argument of their own. They cannot
		// share the case above: readArgument falls back to eating a single bare
		// token when there is no brace, which is right for "\vec x" but wrong
		// here -- "\notag y" was silently swallowing "y" as if it belonged to
		// \notag, when "y" was the next real word in the sentence.
		return " ", index
	}

	if latexTextCommands[name] {
		// The argument is prose, so the hyphen rewrite above has to be undone
		// for it: "\text{p-type}" is a hyphenated word, and handing the maths
		// stage a minus there would have it read 「p减type」.
		body, after, ok := readArgument(source, index)
		if !ok {
			return "", index
		}
		return strings.ReplaceAll(expandMath(body), "−", "-"), after
	}
	if latexTransparent[name] {
		// Font and decoration commands contribute nothing audible; their
		// contents are the whole point of them.
		body, after, ok := readArgument(source, index)
		if !ok {
			return "", index
		}
		return expandMath(body), after
	}
	if symbol, ok := latexSymbols[name]; ok {
		return symbol, index
	}
	if latexNamedOperators[name] {
		return name, index
	}

	// Anything still unrecognised is dropped rather than read. A speech engine
	// given "\operatorname" says "backslash operatorname", and a listener who
	// hears that has learned nothing and lost the sentence; silence at least
	// leaves the surrounding words intact. The argument, if there is one, is
	// deliberately not consumed -- "\boxed{x+1}" should still say x plus one.
	return "", index
}

// braceBody returns the contents of the group opening at index, which the
// caller guarantees is "{", together with the position just past its closer.
// This is the piece RE2 cannot provide: matching braces needs counting, and
// counting needs a loop. An unbalanced group takes the rest of the span, which
// is the reading that loses the least text.
func braceBody(source string, index int) (string, int) {
	depth := 0
	for scan := index; scan < len(source); scan++ {
		switch source[scan] {
		case '\\':
			scan++ // An escaped brace is a printed brace, not a delimiter.
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return source[index+1 : scan], scan + 1
			}
		}
	}
	return source[index+1:], len(source)
}

// readArgument returns the source of the next argument. LaTeX lets a single
// token stand in for a braced group -- "\frac12" is one half, "x^2" is x
// squared -- so both spellings are accepted, and the raw source is returned so
// the caller can decide whether to recurse into it.
func readArgument(source string, index int) (string, int, bool) {
	scan := skipSpaces(source, index)
	if scan >= len(source) || source[scan] == '}' {
		return "", index, false
	}
	if source[scan] == '{' {
		body, next := braceBody(source, scan)
		return body, next, true
	}
	if source[scan] == '\\' {
		next := scan + 1
		if next < len(source) && isCommandLetter(source[next]) {
			for next < len(source) && isCommandLetter(source[next]) {
				next++
			}
		} else if next < len(source) {
			next++
		}
		return source[scan:next], next, true
	}
	_, size := utf8.DecodeRuneInString(source[scan:])
	return source[scan : scan+size], scan + size, true
}

// readOptionalArgument returns the contents of a bracketed argument, as in the
// index of "\sqrt[3]{8}".
func readOptionalArgument(source string, index int) (string, int, bool) {
	scan := skipSpaces(source, index)
	if scan >= len(source) || source[scan] != '[' {
		return "", index, false
	}
	depth := 0
	for cursor := scan; cursor < len(source); cursor++ {
		switch source[cursor] {
		case '\\':
			cursor++
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				return source[scan+1 : cursor], cursor + 1, true
			}
		}
	}
	return "", index, false
}

func skipOptionalArgument(source string, index int) int {
	if _, next, ok := readOptionalArgument(source, index); ok {
		return next
	}
	return index
}

// scriptRun expands a superscript or subscript, and its output is a contract
// with rules_math.go rather than a free choice:
//
//   - "superscript-ascii" there matches a caret followed by an optionally
//     braced signed integer, so "x^{2}" leaves here as "x^2" and "10^{-34}" as
//     "10^-34", with a plain ASCII hyphen;
//   - "subscript-ascii" matches a single-letter base and a short body, so
//     "v_{0}" leaves as "v_0" and "x_{i}" as "x_i";
//   - "integral-with-limits" and "sum-with-limits" read those same forms hanging
//     off "∫" and "∑", which is why the limits need no special case here.
//
// Braces are therefore stripped when the body is a signed integer or a single
// letter, and kept otherwise. Keeping them is a known limitation: "x^{n+1}"
// survives as "x^{n+1}" and no later rule speaks it, because none exists. That
// is still better than "x^n+1", which the maths stage would misread as x to the
// n, plus one. If a downstream stage ever wants the Unicode forms instead --
// speechtext.go's superscriptDigits table suggests "x²" and "10⁻³⁴" are equally
// welcome there -- this function is the only place that decides.
func scriptRun(source string, index int) (string, int) {
	marker := source[index : index+1]
	body, next, ok := readArgument(source, index+1)
	if !ok {
		return marker, index + 1
	}
	content := expandMath(body)
	if content == "" {
		return "", next
	}
	// "90^\circ" is how degrees are written, and "°" is what the maths stage
	// reads as 度.
	if marker == "^" && (content == "∘" || content == "°") {
		return "°", next
	}
	if latexSignedInteger.MatchString(content) {
		// A numeric exponent keeps the ASCII hyphen that expandMath has just
		// converted away. The exponent rules in rules_math.go run after its
		// unary-minus rule, and unary-minus matches any U+2212 anywhere: it
		// would reach "10^−34" first, leave "10^负34", and the caret that
		// carries the whole magnitude would then be spoken by nobody. The
		// ASCII form is invisible to unary-minus, so the exponent survives to
		// the rule that was written for it.
		return marker + strings.Replace(content, "−", "-", 1), next
	}
	if isSingleScriptRune(content) {
		return marker + content, next
	}
	return marker + "{" + content + "}", next
}

var latexSignedInteger = regexp.MustCompile(`^[-−]?[0-9]+$`)

func isSingleScriptRune(content string) bool {
	character, size := utf8.DecodeRuneInString(content)
	return size == len(content) && (unicode.IsLetter(character) || unicode.IsDigit(character))
}

// latexRootDegrees spells the index of a radical, because "3次根号" invites the
// engine to read the digit as a separate number. The table stops at ten; a
// larger or symbolic index falls through as itself, which is how "\sqrt[n]{x}"
// becomes "n次根号x". It is kept local rather than borrowed from rules_math.go
// so that this file compiles on its own.
var latexRootDegrees = map[string]string{
	"1": "一", "2": "二", "3": "三", "4": "四", "5": "五",
	"6": "六", "7": "七", "8": "八", "9": "九", "10": "十",
}

func rootDegree(index string) string {
	index = strings.TrimSpace(index)
	if index == "" {
		return ""
	}
	if word, ok := latexRootDegrees[index]; ok {
		return word + "次"
	}
	return index + "次"
}

func skipSpaces(source string, index int) int {
	for index < len(source) && isSpaceByte(source[index]) {
		index++
	}
	return index
}

func isSpaceByte(character byte) bool {
	return character == ' ' || character == '\t' || character == '\r' || character == '\n'
}

func isDigitByte(character byte) bool {
	return character >= '0' && character <= '9'
}

// isCommandLetter is ASCII-only on purpose: that is exactly what TeX allows in
// the name of a control word, and it is what makes "\alpha中文" end the command
// at the right place.
func isCommandLetter(character byte) bool {
	return (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z')
}

// latexTextCommands hold prose rather than notation. They are separated from
// the font commands below only so that the hyphen rewrite can be undone inside
// them; in every other respect the two tables behave identically.
var latexTextCommands = map[string]bool{
	"text": true, "textrm": true, "textbf": true, "textit": true, "textsf": true,
	"texttt": true, "textnormal": true, "mbox": true,
}

// latexTransparent lists the commands that exist to change how something looks.
// Their contents are ordinary notation and pass straight through;
// "\operatorname{grad}" is the word grad and nothing more.
var latexTransparent = map[string]bool{
	"mathrm": true, "mathbf": true, "mathit": true, "mathsf": true, "mathtt": true,
	"mathcal": true, "mathbb": true, "mathfrak": true, "mathnormal": true,
	"boldsymbol": true, "operatorname": true, "boxed": true,
	// Decorations. The mark itself has no ordinary-notation form and no agreed
	// reading -- a bar is an average here and a conjugate there -- so the
	// symbol underneath is kept and the decoration is let go.
	"overline": true, "underline": true, "bar": true, "hat": true, "widehat": true,
	"tilde": true, "widetilde": true, "dot": true, "ddot": true, "check": true,
}

// latexSymbols maps commands onto the ordinary notation the later stages
// already read. Nothing here is translated into words: rules_math.go owns the
// tables that say × is 乘以 and Δ is 德尔塔, and duplicating them would mean two
// places to fix when a reading turns out wrong.
var latexSymbols = map[string]string{
	// Lowercase Greek. The variant shapes are the same letter to a listener, so
	// "\varepsilon" and "\epsilon" both become ε.
	"alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ",
	"epsilon": "ε", "varepsilon": "ε", "zeta": "ζ", "eta": "η",
	"theta": "θ", "vartheta": "θ", "iota": "ι", "kappa": "κ",
	"lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "omicron": "ο",
	"pi": "π", "varpi": "π", "rho": "ρ", "varrho": "ρ",
	"sigma": "σ", "varsigma": "ς", "tau": "τ", "upsilon": "υ",
	"phi": "φ", "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",

	// Uppercase Greek.
	"Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ",
	"Pi": "Π", "Sigma": "Σ", "Upsilon": "Υ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",

	// Arithmetic and relations.
	"times": "×", "div": "÷", "pm": "±", "mp": "∓",
	"leq": "≤", "le": "≤", "geq": "≥", "ge": "≥",
	"neq": "≠", "ne": "≠", "approx": "≈", "simeq": "≃", "sim": "∼",
	"cong": "≅", "equiv": "≡", "propto": "∝", "infty": "∞",
	"cdot": "·", "ast": "∗", "star": "⋆", "bullet": "•",
	"ll": "≪", "gg": "≫", "oplus": "⊕", "otimes": "⊗",

	// Sets and logic.
	"in": "∈", "notin": "∉", "ni": "∋",
	"subset": "⊂", "subseteq": "⊆", "supset": "⊃", "supseteq": "⊇",
	"cup": "∪", "cap": "∩", "setminus": "∖",
	"emptyset": "∅", "varnothing": "∅",
	"forall": "∀", "exists": "∃", "nexists": "∄",
	"neg": "¬", "lnot": "¬", "land": "∧", "wedge": "∧", "lor": "∨", "vee": "∨",

	// Arrows. The double arrows are implication, the single ones are limits and
	// mappings, and rules_math.go reads each accordingly.
	"Rightarrow": "⇒", "implies": "⇒", "Leftarrow": "⇐",
	"Leftrightarrow": "⇔", "iff": "⇔",
	"rightarrow": "→", "to": "→", "longrightarrow": "→", "mapsto": "↦",
	"leftarrow": "←", "gets": "←", "longleftarrow": "←",
	"leftrightarrow": "↔", "uparrow": "↑", "downarrow": "↓",

	// Calculus and geometry.
	"partial": "∂", "nabla": "∇", "int": "∫", "iint": "∬", "oint": "∮",
	"sum": "∑", "prod": "∏", "surd": "√",
	"therefore": "∴", "because": "∵",
	"perp": "⊥", "parallel": "∥", "angle": "∠", "triangle": "△",
	"degree": "°", "circ": "∘", "prime": "′",

	// Ellipses and fences.
	"dots": "…", "ldots": "…", "cdots": "…", "vdots": "…", "ddots": "…",
	"vert": "|", "lvert": "|", "rvert": "|", "Vert": "‖",
	"langle": "⟨", "rangle": "⟩", "lceil": "⌈", "rceil": "⌉",
	"lfloor": "⌊", "rfloor": "⌋",
	"percent": "%", "hbar": "ℏ", "ell": "ℓ", "Re": "ℜ", "Im": "ℑ", "aleph": "ℵ",
}

// latexNamedOperators are commands whose spoken form is simply the name with
// the backslash taken off. They have to be listed, because the fallback drops
// unknown commands and "\sin x" reduced to "x" would be a silent lie.
var latexNamedOperators = map[string]bool{
	"sin": true, "cos": true, "tan": true, "cot": true, "sec": true, "csc": true,
	"arcsin": true, "arccos": true, "arctan": true,
	"sinh": true, "cosh": true, "tanh": true, "coth": true,
	"log": true, "ln": true, "lg": true, "exp": true,
	"max": true, "min": true, "sup": true, "inf": true,
	"det": true, "dim": true, "gcd": true, "deg": true, "arg": true, "ker": true,
	"mod": true, "bmod": true, "pmod": true, "Pr": true,
}
