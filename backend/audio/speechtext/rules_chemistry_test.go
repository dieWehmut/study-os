package speechtext

import "testing"

// applyChemistry runs only this file's rules, so the expectations here do not
// move when another rule group changes.
func applyChemistry(text string) string {
	for _, rule := range chemistryRules() {
		text = rule.apply(text)
	}
	return text
}

func TestChemistryKnownFormulae(t *testing.T) {
	cases := []struct{ in, want string }{
		{"硫酸是 H₂SO₄", "硫酸是 硫酸"},
		{"ascii 写法 H2SO4", "ascii 写法 硫酸"},
		{"二氧化碳 CO₂ 排放", "二氧化碳 二氧化碳 排放"},
		{"葡萄糖 C₆H₁₂O₆", "葡萄糖 葡萄糖"},
		{"氢氧化钙 Ca(OH)₂", "氢氧化钙 氢氧化钙"},
		{"醋酸 CH₃COOH 的酸性", "醋酸 醋酸 的酸性"},
		{"高锰酸钾 KMnO₄", "高锰酸钾 高锰酸钾"},
		{"食盐 NaCl", "食盐 氯化钠"},
		{"四氧化三铁 Fe₃O₄", "四氧化三铁 四氧化三铁"},
	}
	for _, testCase := range cases {
		t.Run(testCase.in, func(t *testing.T) {
			if got := applyChemistry(testCase.in); got != testCase.want {
				t.Errorf("\n got %q\nwant %q", got, testCase.want)
			}
		})
	}
}

func TestChemistryIons(t *testing.T) {
	cases := []struct{ in, want string }{
		// The benchmark read this one as 铝离子 -- chlorine reported as aluminium,
		// which is the exact kind of error a listener cannot catch.
		{"氯离子 Cl⁻", "氯离子 氯离子"},
		{"钠离子 Na⁺", "钠离子 钠离子"},
		{"硫酸根 SO₄²⁻", "硫酸根 硫酸根离子"},
		{"铵根 NH₄⁺", "铵根 铵根离子"},
		{"碳酸根 CO₃²⁻", "碳酸根 碳酸根离子"},
		{"三价铁 Fe³⁺ 和二价铁 Fe²⁺", "三价铁 铁离子 和二价铁 亚铁离子"},
	}
	for _, testCase := range cases {
		t.Run(testCase.in, func(t *testing.T) {
			if got := applyChemistry(testCase.in); got != testCase.want {
				t.Errorf("\n got %q\nwant %q", got, testCase.want)
			}
		})
	}
}

func TestChemistryReactionNotation(t *testing.T) {
	cases := []struct{ in, want string }{
		{"2H₂ + O₂ → 2H₂O", "2氢气 + 氧气 生成 2水"},
		{"可逆反应 N₂ + 3H₂ ⇌ 2NH₃", "可逆反应 氮气 + 3氢气可逆生成2氨气"},
		{"H₂↑", "氢气气体逸出"},
		{"BaSO₄↓", "硫酸钡沉淀"},
		{"CaCO₃(s) 受热", "碳酸钙固态 受热"},
		{"NaCl(aq)", "氯化钠水溶液"},
		{"CaCO₃ Δ→ CaO + CO₂", "碳酸钙 加热生成 氧化钙 + 二氧化碳"},
	}
	for _, testCase := range cases {
		t.Run(testCase.in, func(t *testing.T) {
			if got := applyChemistry(testCase.in); got != testCase.want {
				t.Errorf("\n got %q\nwant %q", got, testCase.want)
			}
		})
	}
}

func TestChemistryUnknownFormulae(t *testing.T) {
	cases := []struct{ in, want string }{
		{"咖啡因 C₈H₁₀N₄O₂", "咖啡因 C 8, H 10, N 4, O 2"},
		{"ascii C8H10N4O2", "ascii C 8, H 10, N 4, O 2"},
		{"K₂Cr₂O₇ 是氧化剂", "K 2, Cr 2, O 7 是氧化剂"},
	}
	for _, testCase := range cases {
		t.Run(testCase.in, func(t *testing.T) {
			if got := applyChemistry(testCase.in); got != testCase.want {
				t.Errorf("\n got %q\nwant %q", got, testCase.want)
			}
		})
	}
}

// These matter more than the positives. Every one of them has the shape of a
// formula, and a greedy rule would quietly rewrite ordinary text.
func TestChemistryLeavesNonChemistryAlone(t *testing.T) {
	cases := []string{
		"CONTEXT matters here",
		"NO means no",
		"NASA and JSON and CPU and HTTP and API",
		"He said As much At In Be OK",
		"| CO | 一氧化碳 |",
		"这是一段普通的中文笔记，没有化学式。",
		"The COOH group",
		"x → 0 时极限存在",
		"A → B 的推导",
		"版本 V2 已发布",
		"see (g) below",
		"Co 是钴，CO 是一氧化碳",
	}
	for _, input := range cases {
		t.Run(input, func(t *testing.T) {
			if got := applyChemistry(input); got != input {
				t.Errorf("rewrote %q to %q", input, got)
			}
		})
	}
}
