package speechtext

import "testing"

// applyLatex runs only the LaTeX group. Normalize would drag in the other rule
// groups, several of which are still being written, and a failure here should
// point at this file rather than at whichever table happened to change last.
func applyLatex(text string) string {
	for _, rule := range latexRules() {
		text = rule.apply(text)
	}
	return text
}

type latexCase struct {
	name string
	in   string
	want string
}

func runLatexCases(t *testing.T, cases []latexCase) {
	t.Helper()
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := applyLatex(testCase.in); got != testCase.want {
				t.Errorf("applyLatex(%q)\n got: %q\nwant: %q", testCase.in, got, testCase.want)
			}
		})
	}
}

func TestLatexDelimiters(t *testing.T) {
	runLatexCases(t, []latexCase{
		{"inline dollars", "$a+b$", "a+b"},
		{"display dollars", "$$a+b$$", "a+b"},
		{"inline parens", `\(a+b\)`, "a+b"},
		{"display brackets", `\[a+b\]`, "a+b"},
		{"inline keeps surrounding prose", "公式 $E=mc^2$ 很有名", "公式 E=mc^2 很有名"},
		{"display keeps surrounding prose", "推导：$$a+b$$ 完毕", "推导：a+b 完毕"},
		{"two spans in one sentence", "$a$ 和 $b$", "a 和 b"},
		{"display spanning lines", "$$\n\\frac{a}{b}\n$$", "b分之a"},
		{"display and inline behave the same", "$$\\alpha$$", "α"},
	})
}

func TestLatexGreek(t *testing.T) {
	runLatexCases(t, []latexCase{
		{
			"lowercase",
			`$\alpha\beta\gamma\delta\epsilon\varepsilon\zeta\eta\theta\vartheta\iota\kappa\lambda\mu\nu\xi\pi\rho\sigma\tau\upsilon\phi\varphi\chi\psi\omega$`,
			"αβγδεεζηθθικλμνξπρστυφφχψω",
		},
		{
			"uppercase",
			`$\Gamma\Delta\Theta\Lambda\Xi\Pi\Sigma\Upsilon\Phi\Psi\Omega$`,
			"ΓΔΘΛΞΠΣΥΦΨΩ",
		},
		{"spaced", `$\alpha + \beta$`, "α + β"},
	})
}

func TestLatexOperators(t *testing.T) {
	runLatexCases(t, []latexCase{
		{"arithmetic", `$a \times b \div c \pm d \mp e$`, "a × b ÷ c ± d ∓ e"},
		{"orderings", `$a \leq b \le c \geq d \ge e \neq f \ne g$`, "a ≤ b ≤ c ≥ d ≥ e ≠ f ≠ g"},
		{"comparisons", `$a \approx b \equiv c \propto d \infty e \cdot f \ll g \gg h$`, "a ≈ b ≡ c ∝ d ∞ e · f ≪ g ≫ h"},
		{"sets", `$x \in A \notin B \subset C \subseteq D \cup E \cap F \emptyset \varnothing$`, "x ∈ A ∉ B ⊂ C ⊆ D ∪ E ∩ F ∅ ∅"},
		{"logic", `$\forall x \exists y \neg z \lnot w \land p \wedge q \lor r \vee s$`, "∀ x ∃ y ¬ z ¬ w ∧ p ∧ q ∨ r ∨ s"},
		{"arrows", `$A \Rightarrow B \Leftrightarrow C \rightarrow D \to E$`, "A ⇒ B ⇔ C → D → E"},
		{"calculus and geometry", `$\partial \nabla \therefore \because \perp \parallel \angle \degree$`, "∂ ∇ ∴ ∵ ⊥ ∥ ∠ °"},
	})
}

func TestLatexStructures(t *testing.T) {
	runLatexCases(t, []latexCase{
		// Fractions read denominator first, which is the only way Chinese says
		// them, and the recursion is what makes the nested cases work.
		{"fraction", `$\frac{a}{b}$`, "b分之a"},
		{"fraction of greek", `$\frac{\alpha}{\beta}$`, "β分之α"},
		{"nested fraction", `$\frac{\frac{a}{b}}{c}$`, "c分之b分之a"},
		{"display fraction", `$\dfrac{1}{2}$`, "2分之1"},
		{"text fraction", `$\tfrac{1}{2}$`, "2分之1"},
		{"unbraced arguments", `$\frac12$`, "2分之1"},

		{"square root", `$\sqrt{2}$`, "根号2"},
		{"cube root", `$\sqrt[3]{8}$`, "三次根号8"},
		{"general root", `$\sqrt[n]{x}$`, "n次根号x"},
		{"root of a fraction", `$\sqrt{\frac{a}{b}}$`, "根号b分之a"},

		// Scripts leave in the ASCII form rules_math.go consumes.
		{"braced exponent", `$x^{2}$`, "x^2"},
		{"bare exponent", `$x^2$`, "x^2"},
		{"negative exponent", `$10^{-34}$`, "10^-34"},
		{"complex exponent keeps braces", `$x^{n+1}$`, "x^{n+1}"},
		{"subscript", `$a_{1}$`, "a_1"},
		{"letter subscript", `$x_{i}$`, "x_i"},
		{"degrees from circ", `$90^\circ$`, "90°"},

		// The ASCII hyphen is inaudible to the maths stage, which only knows
		// U+2212, so inside a span it is converted -- except in a numeric
		// exponent, where the ASCII form is what the exponent rule reads.
		{"subtraction", `$a - b$`, "a − b"},
		{"negative number", `$-5$`, "−5"},
		{"subtraction of fractions", `$\frac{a}{b} - 1$`, "b分之a − 1"},
		{"numeric exponent keeps the ascii hyphen", `$x^{-1}$`, "x^-1"},
		{"scientific notation keeps the ascii hyphen", `$6.626 \times 10^{-34}$`, "6.626 × 10^-34"},
		{"complex negative exponent", `$e^{-x}$`, "e^{−x}"},
		{"hyphenated word in text is not a minus", `$\text{p-type} - 1$`, "p-type − 1"},

		{"integral with limits", `$\int_{a}^{b} f(x) dx$`, "∫_a^b f(x) dx"},
		{"integral with numeric limits", `$\int_{0}^{1} x dx$`, "∫_0^1 x dx"},
		{"sum with limits", `$\sum_{i=1}^{n} i$`, "∑_{i=1}^n i"},
		{"product with limits", `$\prod_{k=1}^{m} k$`, "∏_{k=1}^m k"},
		// "lim" has to be left free-standing: the maths stage matches it with a
		// word boundary on both sides, which an attached "_" would destroy.
		{"limit", `$\lim_{x \to 0} f(x)$`, "lim x → 0 f(x)"},

		{"text", `$\text{速度}$`, "速度"},
		{"upright and bold", `$\mathrm{d}x \mathbf{v} \mathit{a}$`, "dx v a"},
		{"operatorname", `$\operatorname{grad} u$`, "grad u"},
		{"named operators survive", `$\sin x + \cos y$`, "sin x + cos y"},

		{"left and right", `$\left( \frac{a}{b} \right)$`, "( b分之a )"},
		{"left and right braces", `$\left\{ x \right\}$`, "x"},

		{"wide spacing", `$a \quad b \qquad c$`, "a b c"},
		{"thin spacing", `$a \, b \; c \! d \: e$`, "a b c d e"},

		{"line break becomes a comma", `$$x \\ y$$`, "x， y"},
		{"align environment", `$$\begin{align} x &= 1 \\ y &= 2 \end{align}$$`, "x = 1， y = 2"},
		{"matrix environment", `$$\begin{matrix} a & b \\ c & d \end{matrix}$$`, "a b， c d"},
		{"cases environment", `$$\begin{cases} x & x>0 \\ -x & x<0 \end{cases}$$`, "x x>0， −x x<0"},
		{"bare environment", `\begin{align} a &= b \end{align}`, "a = b"},
		{"equation environment", `$$\begin{equation} E = mc^{2} \end{equation}$$`, "E = mc^2"},
	})
}

func TestLatexUnknownCommands(t *testing.T) {
	runLatexCases(t, []latexCase{
		// Reading "backslash notacommand" aloud is worse than saying nothing,
		// so the command goes and its argument stays.
		{"unknown command is dropped", `$x \notacommand y$`, "x y"},
		{"argument of an unknown command survives", `$\notacommand{y}$`, "y"},
		{"stray grouping braces", `${x}$`, "x"},
		{"unbalanced brace does not eat the span", `$\frac{a$`, "a"},
	})
}

// TestLatexNegatives is the important half of this file: every case here is
// text that must come out exactly as it went in.
func TestLatexNegatives(t *testing.T) {
	runLatexCases(t, []latexCase{
		{"lone price", "$99.99", "$99.99"},
		{"two prices look like a span", "价格 $9.99 和 $12.50", "价格 $9.99 和 $12.50"},
		{"two prices without spaces", "打折后 $5和$6", "打折后 $5和$6"},
		{"price at the end of a sentence", "这本书要 $20。", "这本书要 $20。"},
		{"windows path", `C:\Users\name`, `C:\Users\name`},
		// The hyphen rewrite must not reach outside a span: these are a date, a
		// range and a hyphenated word, not subtractions.
		{"date outside a span", "2024-01-15 提交", "2024-01-15 提交"},
		{"range outside a span", "第 20-30 页", "第 20-30 页"},
		{"date beside a span", `2024-01-15 的作业 $a - b$`, "2024-01-15 的作业 a − b"},
		{"path containing a command name", `打开 D:\Notes\alpha.md`, `打开 D:\Notes\alpha.md`},
		{"maths span then a path", `$x$ 保存在 C:\Users\name`, `x 保存在 C:\Users\name`},
		{"inline code span", "使用 `$x^2$` 表示平方", "使用 `$x^2$` 表示平方"},
		{"fenced code block", "```\n$\\alpha$\n```", "```\n$\\alpha$\n```"},
		{"chinese prose", "这是一段没有任何公式的中文，不应该被改动。", "这是一段没有任何公式的中文，不应该被改动。"},
		{"escaped dollar", `价格是 \$100`, `价格是 \$100`},
		{"dollar with a space after it", "$ x $", "$ x $"},
	})
}

// TestLatexDegenerate covers the shapes that could loop or panic rather than
// merely produce the wrong words.
func TestLatexDegenerate(t *testing.T) {
	runLatexCases(t, []latexCase{
		{"empty text", "", ""},
		{"empty inline span is not maths", "$$", "$$"},
		{"empty display span", "$$$$", ""},
		{"unterminated inline", "$x + 1", "$x + 1"},
		{"unterminated display", "$$x + 1", "$$x + 1"},
		{"unterminated paren delimiter", `\(x + 1`, `\(x + 1`},
		{"unterminated environment", `\begin{align} x`, `\begin{align} x`},
		{"lone backslash inside a span", `$a \$`, `$a \$`},
		{"trailing dollar", "abc$", "abc$"},
		{"only delimiters", `\(\)`, ""},
	})
}
