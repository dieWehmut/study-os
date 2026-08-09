package speechtext

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// mathRules covers notation that is not specific to a science: exponents,
// relations, operators, set theory and the handful of function names that a
// speech engine reads as letters.
//
// It runs after chemistry and physics on purpose. Both of those own notation
// that looks like maths but is not -- the subscripts in H₂SO₄, the exponent in
// m/s² -- and they consume it whole before anything here can take it apart.
func mathRules() []Rule {
	rules := []Rule{
		// Scientific notation has to be matched as one unit. Split across the
		// generic multiplication and exponent rules it still produces the right
		// words, but a benchmark showed the exponent being dropped entirely by
		// the engine ("3×10⁸" -> "3乘10"), which silently changes the value by
		// eight orders of magnitude. Saying it as one phrase removes the seam.
		{
			Name:    "scientific-notation-unicode",
			Pattern: regexp.MustCompile(`([0-9][0-9.,]*)\s*[×xX*]\s*10\s*([⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)`),
			Expand: func(groups []string) string {
				return fmt.Sprintf("%s乘以10的%s次方", groups[1], superscriptNumber(groups[2]))
			},
		},
		{
			Name:    "scientific-notation-ascii",
			Pattern: regexp.MustCompile(`([0-9][0-9.,]*)\s*[×xX*]\s*10\s*\^\s*\{?([-−]?[0-9]+)\}?`),
			Expand: func(groups []string) string {
				return fmt.Sprintf("%s乘以10的%s次方", groups[1], signedNumber(groups[2]))
			},
		},

		// Transpose, determinant and big-O are read as letters otherwise: a
		// benchmark had O(n²) come out as "ohm".
		{Name: "transpose", Pattern: regexp.MustCompile(`([A-Za-z])ᵀ`), Template: "${1}的转置"},
		{Name: "determinant", Pattern: regexp.MustCompile(`\bdet\s*\(\s*([A-Za-z])\s*\)`), Template: "${1}的行列式"},
		{Name: "big-o", Pattern: regexp.MustCompile(`\bO\s*\(([^)]{1,24})\)`), Template: "大O $1"},
		{Name: "combination", Pattern: regexp.MustCompile(`\bC\s*\(\s*([A-Za-z0-9]+)\s*,\s*([A-Za-z0-9]+)\s*\)`), Template: "${1}取${2}的组合数"},

		// Logarithms: the base is a subscript, so this has to run before the
		// generic subscript rule turns it into "log 下标 2".
		//
		// The marker that says "what follows is a base" has to be required, not
		// optional. It used to be optional, and "$\log 10$" -- log of 10, no base
		// implied -- was read as 「以10为底的对数」: the argument was mistaken for
		// a subscript it never carried. A genuine base is either a Unicode
		// subscript digit run sitting directly against "log" (self-marking, no
		// separator needed) or an explicit underscore.
		{
			Name:    "log-base",
			Pattern: regexp.MustCompile(`\blog(?:([₀-₉]{1,3})|\s*_\s*\{?([0-9]{1,3})\}?)`),
			Expand: func(groups []string) string {
				base := groups[1]
				if base == "" {
					base = groups[2]
				}
				return fmt.Sprintf("以%s为底的对数", asciiDigits(base, subscriptDigits))
			},
		},
		{Name: "natural-log", Pattern: regexp.MustCompile(`\bln\b`), Template: "自然对数"},
		{Name: "common-log", Pattern: regexp.MustCompile(`\blg\b`), Template: "常用对数"},
		{Name: "bare-log", Pattern: regexp.MustCompile(`\blog\b`), Template: "对数"},

		// Integrals and sums with limits. Same reasoning as scientific
		// notation: the limits are subscripts and superscripts hanging off a
		// symbol, and reading them in isolation produces word salad -- the
		// benchmark turned "∫₀¹" into 「顶级分伏」 and "Σᵢ₌₁ⁿ" into 「求和倒腰I」.
		//
		// The `_`/`^` markers below are never optional when the content is
		// plain ASCII. They used to be, and a lower-only integral or sum ate
		// whatever ordinary text came after it as a bogus upper limit --
		// "$\int_0 x^2\,dx$" read the integrand's exponent as the integral's
		// upper bound and produced 「从0到x的积分²」, and "$\sum_{i=1} a_i$" ate
		// the summand and produced 「i从1到a求和_i」. A genuine limit is either a
		// Unicode subscript/superscript run sitting directly against the symbol
		// (self-marking, no separator needed -- "∫₀¹") or content introduced by
		// an explicit `_`/`^` ("∫_0^1"). Plain digits with neither is not a
		// limit at all, and the rule now leaves it alone.
		{
			Name: "integral-with-limits",
			Pattern: regexp.MustCompile(
				`∫\s*(?:_\s*\{?([0-9A-Za-z]+)\}?|([₀-₉]+))` +
					`(?:\s*\^\s*\{?([0-9A-Za-z]+)\}?|([⁰-⁹]+))?`),
			Expand: func(groups []string) string {
				lower := groups[1]
				if lower == "" {
					lower = groups[2]
				}
				lower = asciiDigits(lower, subscriptDigits)
				upper := groups[3]
				if upper == "" {
					upper = groups[4]
				}
				upper = superscriptNumber(upper)
				if upper == "" {
					return fmt.Sprintf("从%s开始的积分", lower)
				}
				return fmt.Sprintf("从%s到%s的积分", lower, upper)
			},
		},
		{
			Name: "sum-with-limits",
			Pattern: regexp.MustCompile(
				`[∑Σ]\s*(?:_\s*\{?([0-9A-Za-z]+)\s*[=]\s*([0-9A-Za-z]+)\}?|([₀-₉]+)\s*[₌]\s*([₀-₉]+))` +
					`(?:\s*\^\s*\{?([0-9A-Za-z]+)\}?|([⁰-⁹]+))?`),
			Expand: func(groups []string) string {
				index, from := groups[1], groups[2]
				if index == "" {
					index, from = groups[3], groups[4]
				}
				index = asciiDigits(index, subscriptDigits)
				from = asciiDigits(from, subscriptDigits)
				to := groups[5]
				if to == "" {
					to = groups[6]
				}
				to = superscriptNumber(to)
				if to == "" {
					return fmt.Sprintf("%s从%s开始求和", index, from)
				}
				return fmt.Sprintf("%s从%s到%s求和", index, from, to)
			},
		},

		// Derivatives. The prime is invisible to the engine, so f′(x) was read
		// as plain "f x" -- indistinguishable from the function itself.
		//
		// "Double prime" has three spellings in the wild and the rule used to
		// know only one of them ({2} of the class, i.e. two separate ′/″
		// characters back to back). U+2033 ″ is a single codepoint that already
		// means "double prime" -- it does not repeat -- and two plain ASCII
		// apostrophes ('') are the everyday substitute for anyone who cannot
		// type a real prime. Both were falling through untouched.
		{Name: "second-derivative", Pattern: regexp.MustCompile(`([A-Za-z])(?:″|′′|'')\s*\(`), Template: "${1}二撇("},
		{Name: "first-derivative", Pattern: regexp.MustCompile(`([A-Za-z])[′']\s*\(`), Template: "${1}一撇("},

		// Absolute value runs before the minus rules, because it has to see its
		// own contents while they are still notation: once "|x − 3|" has become
		// "|x减3|" the bars no longer enclose anything this pattern recognises.
		//
		// The guard is deliberately tight. A markdown table row is nothing but
		// pipes, and turning "| 3 |" into "3的绝对值" would corrupt every table in
		// the vault. Requiring the content to begin and end with an alphanumeric
		// excludes padded table cells, which always carry surrounding spaces.
		{
			Name:     "absolute-value",
			Pattern:  regexp.MustCompile(`\|([A-Za-z][A-Za-z0-9 −+\-]{0,8}[A-Za-z0-9]|[A-Za-z])\|`),
			Template: "${1}的绝对值",
		},
		// Factorial carries the same shape of risk with exclamation marks in
		// ordinary prose. The word boundary means "Wow!" cannot match, because
		// there is no boundary between the two final letters.
		{Name: "factorial", Pattern: regexp.MustCompile(`\b([A-Za-z0-9])!`), Template: "${1}的阶乘"},

		// The Unicode minus is the single worst offender the benchmark found:
		// "−5x" was read as 「给5x」 and "−273.15" as 「底273.15」. It is also
		// genuinely ambiguous, so the character on its left decides.
		//
		// It is a subtraction only when something ASCII-arithmetic precedes it.
		// Superscript digits are in that class because these rules run before
		// exponents are expanded, and "3x² − 5x" must still be a subtraction.
		// Anything else -- a Chinese character, an opening bracket, the start of
		// the string -- means there is no left operand, so it is a sign: in
		// 「温度 −273.15」 the minus belongs to the number, not to 温度.
		// A minus directly after a caret or underscore belongs to the exponent,
		// not to the expression, and it has to be protected before the two rules
		// below get to it. Otherwise unary-minus -- which matches U+2212
		// anywhere -- turns "10^−34" into "10^负34", and by the time
		// superscript-ascii runs there is no sign left for it to recognise, so
		// the caret is spoken by nobody and the magnitude disappears in silence.
		//
		// Folding it back to the ASCII hyphen is enough, because that form is
		// invisible to the minus rules and is exactly what the exponent rules
		// expect. This lives here rather than in the LaTeX stage so it also
		// covers "10^−34" typed straight into a note, which never sees a
		// maths span.
		{Name: "exponent-sign", Pattern: regexp.MustCompile(`([\^_])(\{?)\s*−\s*`), Template: "${1}${2}-"},

		{Name: "binary-minus", Pattern: regexp.MustCompile(`([0-9A-Za-z)\]⁰¹²³⁴⁵⁶⁷⁸⁹ᵀ])\s*−\s*`), Template: "${1}减"},
		{Name: "unary-minus", Pattern: regexp.MustCompile(`−\s*`), Template: "负"},

		// Exponents. Two is 平方 and three is 立方 because that is how they are
		// said; everything else takes the general form.
		{
			Name:    "superscript-unicode",
			Pattern: regexp.MustCompile(`([A-Za-z0-9)\]])([⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)`),
			Expand: func(groups []string) string {
				return groups[1] + exponentPhrase(superscriptNumber(groups[2]))
			},
		},
		{
			Name:    "superscript-ascii",
			Pattern: regexp.MustCompile(`([A-Za-z0-9)\]])\^\s*\{?(-?[0-9]+)\}?`),
			Expand: func(groups []string) string {
				return groups[1] + exponentPhrase(signedNumber(groups[2]))
			},
		},

		// Subscripts. Restricted to a single-letter base so that snake_case
		// identifiers in technical notes -- foo_bar, api_key -- are left alone;
		// there is no word boundary before the underscore in those.
		{
			Name:    "subscript-unicode",
			Pattern: regexp.MustCompile(`([A-Za-z])([₀₁₂₃₄₅₆₇₈₉]+)`),
			Expand: func(groups []string) string {
				return groups[1] + "下标" + asciiDigits(groups[2], subscriptDigits)
			},
		},
		{
			Name:     "subscript-ascii",
			Pattern:  regexp.MustCompile(`\b([A-Za-z])_\{?([0-9]{1,3}|[a-z])\}?\b`),
			Template: "${1}下标$2",
		},

		{Name: "cube-root", Pattern: regexp.MustCompile(`∛\s*`), Template: "三次根号"},
		{Name: "square-root", Pattern: regexp.MustCompile(`√\s*`), Template: "根号"},
		{Name: "contour-integral", Pattern: regexp.MustCompile(`∮`), Template: "环路积分"},
		{Name: "bare-integral", Pattern: regexp.MustCompile(`∫`), Template: "积分"},
		{Name: "product", Pattern: regexp.MustCompile(`∏`), Template: "连乘"},
		// A summation sign with limits was consumed above. One without limits still
		// needs a reading, or it is dropped in silence -- and U+2211 is a different
		// character from the Greek capital sigma the greek table covers.
		{Name: "bare-sum", Pattern: regexp.MustCompile(`∑`), Template: "求和"},
		{Name: "partial", Pattern: regexp.MustCompile(`∂`), Template: "偏导"},
		{Name: "nabla", Pattern: regexp.MustCompile(`∇`), Template: "梯度"},
		{Name: "limit", Pattern: regexp.MustCompile(`\blim\b`), Template: "极限"},
	}

	rules = append(rules, tableRule("relations", map[string]string{
		"×": "乘以", "÷": "除以", "±": "正负", "∓": "负正",
		"≠": "不等于", "≈": "约等于", "≅": "约等于", "≡": "恒等于",
		"≤": "小于等于", "≥": "大于等于", "≪": "远小于", "≫": "远大于",
		"∝": "正比于", "∞": "无穷大", "∠": "角", "⊥": "垂直于", "∥": "平行于",
		"∈": "属于", "∉": "不属于", "⊂": "包含于", "⊆": "包含于", "⊃": "包含", "⊇": "包含",
		"∪": "并", "∩": "交", "∅": "空集",
		"∀": "任意", "∃": "存在", "¬": "非", "∧": "且", "∨": "或",
		"⇒": "推出", "⇔": "当且仅当", "∴": "所以", "∵": "因为",
		"½": "二分之一", "⅓": "三分之一", "⅔": "三分之二", "¼": "四分之一",
		"¾": "四分之三", "⅕": "五分之一", "⅙": "六分之一", "⅛": "八分之一",
	}))

	// Uppercase Greek was the worst block in the benchmark: 「Δ Σ Ω Φ Γ」 came
	// out as 「杵取笼子」. Lowercase Greek was read correctly and is therefore
	// left alone -- rewriting it would only add a chance to make it worse.
	rules = append(rules, tableRule("greek-uppercase", map[string]string{
		"Α": "阿尔法", "Β": "贝塔", "Γ": "伽马", "Δ": "德尔塔", "Ε": "艾普西龙",
		"Ζ": "泽塔", "Η": "伊塔", "Θ": "西塔", "Ι": "约塔", "Κ": "卡帕",
		"Λ": "兰姆达", "Μ": "缪", "Ν": "纽", "Ξ": "克西", "Ο": "奥米克戎",
		"Π": "派", "Ρ": "柔", "Σ": "西格玛", "Τ": "陶", "Υ": "宇普西龙",
		"Φ": "斐", "Χ": "卡伊", "Ψ": "普西", "Ω": "欧米伽",
	}))

	rules = append(rules,
		// Degrees. °C and °F are units and were already consumed by the physics
		// stage, so anything left here is an angle.
		Rule{Name: "degree", Pattern: regexp.MustCompile(`°`), Template: "度"},
		// A prime after a number is an angular minute; after a letter it was a
		// derivative and has already been handled above.
		Rule{Name: "arcminute", Pattern: regexp.MustCompile(`([0-9])′`), Template: "${1}分"},
		Rule{Name: "arcsecond", Pattern: regexp.MustCompile(`([0-9])″`), Template: "${1}秒"},
		// Reaction arrows were consumed by the chemistry stage, so a surviving
		// arrow is the limit sense: x → 0.
		Rule{Name: "tends-to", Pattern: regexp.MustCompile(`\s*[→⟶]\s*`), Template: "趋于"},
		Rule{
			Name:    "roman-numeral-name",
			Pattern: regexp.MustCompile(`\b([A-Z][a-z]{2,})\s+([IVXLCDM]{1,7})\b`),
			Expand: func(groups []string) string {
				value := romanToInt(groups[2])
				if value == 0 {
					return groups[0]
				}
				return groups[1] + chineseNumber(value)
			},
		},
		Rule{
			Name:    "roman-numeral-chapter",
			Pattern: regexp.MustCompile(`第\s*([IVXLCDMⅠ-Ⅻ]{1,7})\s*([章节部篇卷])`),
			Expand: func(groups []string) string {
				value := romanToInt(groups[1])
				if value == 0 {
					return groups[0]
				}
				return "第" + chineseNumber(value) + groups[2]
			},
		},
	)

	return rules
}

// tableRule compiles a whole substitution table into one rule. One pass over
// the text per table rather than per entry keeps a few hundred replacements
// affordable on every synthesis.
func tableRule(name string, table map[string]string) Rule {
	pattern := regexp.MustCompile(alternation(keysOf(table)))
	return Rule{
		Name:    name,
		Pattern: pattern,
		Expand: func(groups []string) string {
			return table[groups[0]]
		},
	}
}

// exponentPhrase says 平方 and 立方 for the two exponents that have their own
// words, because "x的2次方" is technically correct but sounds like a machine.
func exponentPhrase(number string) string {
	switch number {
	case "2":
		return "的平方"
	case "3":
		return "的立方"
	}
	return "的" + number + "次方"
}

// superscriptNumber turns "⁻³⁴" into "负34", keeping the sign, which the engine
// otherwise drops.
func superscriptNumber(text string) string {
	if text == "" {
		return ""
	}
	negative := strings.HasPrefix(text, "⁻")
	digits := asciiDigits(strings.TrimPrefix(text, "⁻"), superscriptDigits)
	if negative {
		return "负" + digits
	}
	return digits
}

// signedNumber accepts either hyphen. The LaTeX stage normalises ASCII "-" to
// U+2212 inside a maths span so that a bare "a - b" is audible at all, and an
// exponent written "10^-34" in plain text still arrives with the ASCII form.
func signedNumber(text string) string {
	for _, sign := range []string{"-", "−"} {
		if strings.HasPrefix(text, sign) {
			return "负" + strings.TrimPrefix(text, sign)
		}
	}
	return text
}

var romanValues = map[byte]int{'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000}

// romanToInt returns 0 for anything that is not a well-formed numeral, which is
// the signal for the caller to leave the text alone. Initials and acronyms --
// "Mr LI", "Louis CD" -- happen to be made of the same letters, and reading one
// as a number would be worse than not expanding it at all.
func romanToInt(text string) int {
	if text == "" {
		return 0
	}
	total := 0
	previous := 0
	for index := len(text) - 1; index >= 0; index-- {
		value, ok := romanValues[text[index]]
		if !ok {
			return 0
		}
		if value < previous {
			total -= value
		} else {
			total += value
			previous = value
		}
	}
	if total <= 0 || total > 3999 {
		return 0
	}
	// Round-tripping rejects malformed numerals such as "IIII" or "VX", which
	// are far more likely to be initials than a number.
	if intToRoman(total) != text {
		return 0
	}
	return total
}

func intToRoman(value int) string {
	type pair struct {
		value  int
		symbol string
	}
	table := []pair{
		{1000, "M"}, {900, "CM"}, {500, "D"}, {400, "CD"},
		{100, "C"}, {90, "XC"}, {50, "L"}, {40, "XL"},
		{10, "X"}, {9, "IX"}, {5, "V"}, {4, "IV"}, {1, "I"},
	}
	var builder strings.Builder
	for _, entry := range table {
		for value >= entry.value {
			builder.WriteString(entry.symbol)
			value -= entry.value
		}
	}
	return builder.String()
}

var chineseDigits = [...]string{"零", "一", "二", "三", "四", "五", "六", "七", "八", "九"}

// chineseNumber covers 1..99, which is every chapter number and every monarch
// anyone writes in Roman numerals. Larger values fall back to the digits.
func chineseNumber(value int) string {
	switch {
	case value <= 0 || value > 99:
		return strconv.Itoa(value)
	case value < 10:
		return chineseDigits[value]
	case value == 10:
		return "十"
	case value < 20:
		return "十" + chineseDigits[value%10]
	case value%10 == 0:
		return chineseDigits[value/10] + "十"
	}
	return chineseDigits[value/10] + "十" + chineseDigits[value%10]
}

// abbreviationRules expands Latin abbreviations, which the engine spells out
// letter by letter with dreadful results -- the benchmark produced 「1G」 for
// "e.g." and 「PSD穴位」 for "Ph.D.". The user chose English full forms over
// Chinese glosses, so the reading stays in the language the abbreviation is in.
func abbreviationRules() []Rule {
	table := map[string]string{
		"e.g.":    "for example",
		"i.e.":    "that is",
		"etc.":    "et cetera",
		"vs.":     "versus",
		"cf.":     "compare",
		"et al.":  "and others",
		"Ph.D.":   "Doctor of Philosophy",
		"Dr.":     "Doctor",
		"Mr.":     "Mister",
		"Mrs.":    "Missus",
		"Prof.":   "Professor",
		"approx.": "approximately",
		"Fig.":    "Figure",
		"Eq.":     "Equation",
		"No.":     "Number",
	}
	// The trailing dot is part of the key, so a bare "no" or "figure" in prose
	// cannot match. Case is significant for the same reason.
	return []Rule{tableRule("abbreviations", table)}
}

// polyphoneRules is deliberately empty.
//
// The benchmark found exactly one polyphone failure -- 乐 in 乐曲 -- while
// 行长, 出差, 血压, 重量 and 调查空调 were all read correctly, so the engine's own
// disambiguation is already good. Fixing 乐 by substitution would mean either
// swapping in a homophone (making the text a lie, and the cache key a lie with
// it) or rewriting the word into a synonym that does not mean quite the same
// thing. Neither is worth it for one word, and both would fire on text this
// package cannot see the context of. The hook stays so a future rule has an
// obvious home.
func polyphoneRules() []Rule {
	return nil
}
