package speechtext

import "testing"

// The cases here are drawn from a recorded benchmark of the local voice: every
// "want" is a fix for something the engine was measured getting wrong, so a
// failure means a regression against real observed behaviour rather than
// against an opinion about how maths should sound.
func TestNormalizeMath(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"squared", "面积是 x²", "面积是 x的平方"},
		{"cubed", "体积 r³", "体积 r的立方"},
		{"ascii exponent", "复杂度 n^2", "复杂度 n的平方"},
		{"braced ascii exponent", "n^{10}", "n的10次方"},
		{"scientific notation", "光速 3×10⁸", "光速 3乘以10的8次方"},
		{"negative exponent", "6.626×10⁻³⁴", "6.626乘以10的负34次方"},
		// A note can carry an ASCII caret next to a Unicode minus without ever
		// going through a LaTeX span, and that combination used to lose the
		// caret entirely -- the sign was consumed first and the exponent rule
		// then found nothing to match.
		{"ascii caret with unicode minus", "10^−34", "10的负34次方"},
		{"braced caret with unicode minus", "x^{−1}", "x的负1次方"},
		{"binary minus", "5 − 3", "5减3"},
		{"minus after exponent", "3x² − 5x", "3x的平方减5x"},
		{"unary minus after chinese", "温度 −273.15", "温度 负273.15"},
		{"unary minus at start", "−2 ≤ x", "负2 小于等于 x"},
		{"transpose", "矩阵 Aᵀ", "矩阵 A的转置"},
		{"determinant", "det(A) 不为零", "A的行列式 不为零"},
		{"big o", "复杂度是 O(n)", "复杂度是 大O n"},
		{"log base", "log₂ 8", "以2为底的对数 8"},
		{"natural log", "ln e = 1", "自然对数 e = 1"},
		{"absolute value", "|x − 3| ≤ 5", "x减3的绝对值 小于等于 5"},
		{"factorial", "求 n! 的值", "求 n的阶乘 的值"},
		{"subscript", "初速度 v₀", "初速度 v下标0"},
		{"square root", "√2 约等于 1.414", "根号2 约等于 1.414"},
		{"uppercase greek", "变化量 Δ", "变化量 德尔塔"},
		{"relations", "a ≠ b 且 c ≈ d", "a 不等于 b 且 c 约等于 d"},
		{"infinity", "趋于 ∞", "趋于 无穷大"},
		{"fraction glyph", "占 ½", "占 二分之一"},
		{"degree", "角度 90°", "角度 90度"},
		{"roman monarch", "Louis XIV 时期", "Louis十四 时期"},
		{"abbreviation", "e.g. 这样", "for example 这样"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := Normalize(testCase.in); got != testCase.want {
				t.Errorf("Normalize(%q)\n got %q\nwant %q", testCase.in, got, testCase.want)
			}
		})
	}
}

// Prose is the common case by a wide margin, and a rule that fires on it is
// strictly worse than no rule at all: it corrupts text the engine already read
// correctly. These are the shapes most likely to trip a greedy pattern.
func TestNormalizeLeavesOrdinaryTextAlone(t *testing.T) {
	cases := []string{
		"这是一段普通的中文笔记，没有任何公式。",
		"The quick brown fox jumps over the lazy dog.",
		"| 名称 | 说明 |",
		"| 3 | 说明 |",
		"Wow! That was surprising.",
		"snake_case_identifier and api_key stay intact",
		"路径是 C:\\Users\\name\\Documents",
		"价格 $99.99",
		"他说 the result is fine",
		"1 + 1 = 2",
	}
	for _, input := range cases {
		t.Run(input, func(t *testing.T) {
			if got := Normalize(input); got != input {
				t.Errorf("Normalize(%q) rewrote prose to %q", input, got)
			}
		})
	}
}

// Normalize has to be idempotent because the audio service applies it while
// canonicalising a request and again while deriving the cache key. If a second
// pass changed the text, the key would not describe the audio.
func TestNormalizeIsIdempotent(t *testing.T) {
	inputs := []string{
		"f(x) = 3x² − 5x + 2，其导数 f′(x) = 6x − 5",
		"光速 c = 3×10⁸ m/s，普朗克常数 h = 6.626×10⁻³⁴ J·s",
		"设 α + β = 90°，则 sin α = cos β",
		"硫酸 H₂SO₄ 与氢氧化钠 NaOH 反应",
		"温度 −273.15 °C 即 0 K",
		"这是一段普通的中文笔记。",
		"$\\frac{a}{b}$ 和 $x^2$",
	}
	for _, input := range inputs {
		t.Run(input, func(t *testing.T) {
			once := Normalize(input)
			twice := Normalize(once)
			if once != twice {
				t.Errorf("not idempotent\ninput  %q\nonce   %q\ntwice  %q", input, once, twice)
			}
		})
	}
}

// Each rule group has its own tests, and by construction none of them can see
// what a later group does to its output. These cases are the ones where that
// blind spot bit: they only fail through the full pipeline.
func TestNormalizeAcrossStages(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			// Chemistry spells an unnamed formula out letter by letter, and a
			// space-joined "C 8 H 10 N 4" hands the physics stage the exact
			// shape of a magnitude and a unit: this used to read as eight
			// henries and ten newtons.
			"spelled formula is not read as units",
			"咖啡因 C₈H₁₀N₄O₂",
			"咖啡因 C 8, H 10, N 4, O 2",
		},
		{
			// The chemical arrow and the limit arrow are the same character.
			// Chemistry claims it only between two formulae; anything left is
			// the maths reading.
			"reaction arrow and limit arrow are told apart",
			"2H₂ + O₂ → 2H₂O，而当 x → 0 时",
			"2氢气 + 氧气 生成 2水，而当 x趋于0 时",
		},
		{
			// LaTeX produces ordinary notation, which the maths stage then
			// speaks; neither half is correct alone.
			"latex feeds the maths stage",
			"$\\frac{1}{2}mv^2$",
			"2分之1mv的平方",
		},
		{
			// The space after 德尔塔 is the LaTeX stage's, and is correct: a
			// command name runs up to the next non-letter, so "\DeltaE" would
			// be one unknown command rather than a delta and an E.
			"latex greek reaches the greek table",
			"$\\Delta E = h\\nu$",
			"德尔塔 E = hν",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := Normalize(testCase.in); got != testCase.want {
				t.Errorf("Normalize(%q)\n got %q\nwant %q", testCase.in, got, testCase.want)
			}
		})
	}
}

func TestNormalizeEmpty(t *testing.T) {
	if got := Normalize(""); got != "" {
		t.Errorf("Normalize(\"\") = %q, want empty", got)
	}
}

// An independent review (codex, reading this package fresh rather than the
// benchmark transcript) found five more ways a structural marker could be
// optional when it needed to be mandatory, or a class of prime could be
// spelled in a way the rules did not recognise. Every case here reproduced a
// real silent-content-loss failure before the corresponding fix.
func TestNormalizeIndependentReviewFindings(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			// The integral's lower bound needs an explicit `_` (or a self-marking
			// Unicode subscript) to be recognised as a limit at all. Without that
			// guard, a bare "∫_0 x^2" swallowed the integrand's own exponent as
			// if it were the integral's upper bound.
			"integral with only a lower limit does not eat the integrand",
			`$\int_0 x^2\,dx$`,
			"从0开始的积分 x的平方 dx",
		},
		{
			// Same shape of bug, one symbol over: a sum with only a lower limit
			// was reading the next word in the sentence as its upper limit.
			"sum with only a lower limit does not eat the summand",
			`$\sum_{i=1} a_i$`,
			"i从1开始求和 a下标i",
		},
		{
			// "log 10" has no base marker at all -- no subscript, no
			// underscore -- so 10 is the argument, not the base.
			"log without a subscript is not given a base",
			`$\log 10$`,
			"对数 10",
		},
		{
			// U+2033 ″ is one codepoint that already means "double prime"; it
			// does not need to appear twice. Two ASCII apostrophes are the
			// everyday substitute for a prime nobody can type. Neither used to
			// be recognised -- only two adjacent ′/″ characters were.
			"second derivative in its ascii and single-codepoint spellings",
			"f″(x) and f''(x)",
			"f二撇(x) and f二撇(x)",
		},
		{
			// \notag and \nonumber take no argument, ever. They used to share a
			// case with commands that do (\hspace, \label, ...), and the
			// argument reader's single-token fallback -- correct for "\vec x" --
			// ate the next real word as if it belonged to \notag.
			"notag takes no argument and does not eat the next word",
			`$x \notag y$`,
			"x y",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := Normalize(testCase.in); got != testCase.want {
				t.Errorf("Normalize(%q)\n got %q\nwant %q", testCase.in, got, testCase.want)
			}
		})
	}
}
