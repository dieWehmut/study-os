package speechtext

import (
	"regexp"
	"strings"
)

// chemistryRules turns formulae into the words a chemist would say.
//
// It runs first in the pipeline. A formula is mostly subscripts, and the maths
// stage would take them apart character by character -- "H₂SO₄" has to be
// claimed whole before anything gets the chance to read "₂" as "subscript two".
//
// The failure this file exists to prevent is silence, not mispronunciation. A
// benchmark of the local voice read "H₂SO₄" as 「Hs」, dropped every subscript in
// C₆H₁₂O₆, and turned "Cl⁻ 氯离子" into 「铝离子」 -- chlorine reported as
// aluminium. None of those are audible as errors to someone listening.
func chemistryRules() []Rule {
	return []Rule{
		heatingConditionRule(),
		reactionArrowRule(),
		reversibleArrowRule(),
		phaseMarkerRule(),
		evolutionRule(),
		ionRule(),
		formulaRule(),
	}
}

// A formula is recognised as one maximal token rather than by looking up names
// inside a longer string. Matching names first looks simpler and is wrong: the
// tail of C₈H₁₀N₄O₂ ends in "O₂", so a name-first pass reads caffeine as
// "C 8 H 10 N 4 氧气". Claim the whole token, then decide what it is.
const (
	// One element and its count, or a parenthesised group and its count, as in
	// the (OH)₂ of Ca(OH)₂.
	formulaPiece = `[A-Z][a-z]?[0-9₀-₉]*|\((?:[A-Z][a-z]?[0-9₀-₉]*)+\)[0-9₀-₉]*`

	// The character before a formula may not be a letter or a digit. Excluding
	// letters keeps the "CO" out of "CONTEXT"; excluding digits stops a match
	// starting midway through a token. RE2 has no lookbehind, so it is captured
	// and put back -- only one character, which is always a delimiter, so two
	// formulae separated by a single comma both still match.
	formulaLead = `([^A-Za-z0-9₀-₉]|^)`

	// Likewise for what follows: "CO2e" is not carbon dioxide.
	formulaTrail = `([A-Za-z0-9]?)`
)

// -------------------------------------------------------------------------- //
// Reaction notation
// -------------------------------------------------------------------------- //

// heatingConditionRule reads the delta written on a reaction arrow as 加热, and
// consumes the arrow with it.
//
// Scoped to a delta that is actually touching an arrow, because the same
// character is the maths stage's 德尔塔 and is far more often that. A delta
// anywhere else is left alone deliberately: being read as 德尔塔 is wrong but
// audible, whereas a false 加热 invents a reaction condition nobody wrote.
func heatingConditionRule() Rule {
	return Rule{
		Name:     "chemistry.heating-condition",
		Pattern:  regexp.MustCompile(`(\s*)[(（]?\s*Δ\s*[)）]?\s*[→⟶](\s*)`),
		Template: "${1}加热生成${2}",
	}
}

// formulaOperand is a chemical-looking token: an optional coefficient, then a
// capitalised element symbol, then more of the same.
const formulaOperand = `[0-9]*[A-Z][A-Za-z0-9₀-₉⁺⁻()]*`

var operandLooksChemical = regexp.MustCompile(`[0-9₀-₉]|^[0-9]*[A-Z][a-z]`)

// reactionArrowRule says 生成 for the arrow in an equation.
//
// The arrow is genuinely ambiguous: the maths stage reads a surviving one as
// 趋于, which is what "x → 0" needs. The heuristic here is that both sides must
// look like formulae -- capitalised, and carrying either a digit or a
// two-letter element symbol. That rejects "x → 0" on the lowercase x, and
// rejects a prose "A → B" because single capitals carry neither mark.
//
// Deliberately conservative. A missed 生成 costs one word; a false one invents
// chemistry inside a sentence that had none.
func reactionArrowRule() Rule {
	pattern := regexp.MustCompile(`(` + formulaOperand + `)(\s*)[→⟶](\s*)(` + formulaOperand + `)`)
	return Rule{
		Name:    "chemistry.reaction-arrow",
		Pattern: pattern,
		Expand: func(groups []string) string {
			left, right := groups[1], groups[4]
			if !operandLooksChemical.MatchString(left) || !operandLooksChemical.MatchString(right) {
				return groups[0]
			}
			return left + groups[2] + "生成" + groups[3] + right
		},
	}
}

// The double arrow has no competing reading, so it needs no context test.
func reversibleArrowRule() Rule {
	return Rule{
		Name:     "chemistry.reversible-arrow",
		Pattern:  regexp.MustCompile(`\s*⇌\s*`),
		Template: "可逆生成",
	}
}

// phaseMarkerRule expands (s)/(l)/(g)/(aq), which are silent otherwise.
//
// Anchored to a capitalised formula on the left, not merely to any character:
// requiring only "a letter" turned the ordinary parenthetical in "see (g)
// below" into 气态.
func phaseMarkerRule() Rule {
	phases := map[string]string{"s": "固态", "l": "液态", "g": "气态", "aq": "水溶液"}
	pattern := regexp.MustCompile(`([A-Z][A-Za-z0-9₀-₉()]*)\s*\((s|l|g|aq)\)`)
	return Rule{
		Name:    "chemistry.phase-marker",
		Pattern: pattern,
		Expand: func(groups []string) string {
			return groups[1] + phases[groups[2]]
		},
	}
}

// evolutionRule reads the gas and precipitate arrows, which are the two symbols
// in an equation carrying the actual result of the reaction.
func evolutionRule() Rule {
	return Rule{
		Name:    "chemistry.evolution",
		Pattern: regexp.MustCompile(`([A-Z][A-Za-z0-9₀-₉()]*)\s*([↑↓])`),
		Expand: func(groups []string) string {
			if groups[2] == "↑" {
				return groups[1] + "气体逸出"
			}
			return groups[1] + "沉淀"
		},
	}
}

// -------------------------------------------------------------------------- //
// Ions
// -------------------------------------------------------------------------- //

var ionNames = map[string]string{
	"Na⁺": "钠离子", "K⁺": "钾离子", "Ca²⁺": "钙离子", "Mg²⁺": "镁离子",
	"Al³⁺": "铝离子", "Fe²⁺": "亚铁离子", "Fe³⁺": "铁离子", "H⁺": "氢离子",
	"NH₄⁺": "铵根离子", "Zn²⁺": "锌离子", "Cu²⁺": "铜离子", "Ag⁺": "银离子",
	"Ba²⁺": "钡离子", "Li⁺": "锂离子",
	"Cl⁻": "氯离子", "OH⁻": "氢氧根离子", "SO₄²⁻": "硫酸根离子",
	"CO₃²⁻": "碳酸根离子", "NO₃⁻": "硝酸根离子", "PO₄³⁻": "磷酸根离子",
	"Br⁻": "溴离子", "I⁻": "碘离子", "F⁻": "氟离子", "S²⁻": "硫离子",
	"HCO₃⁻": "碳酸氢根离子", "MnO₄⁻": "高锰酸根离子",
}

// Ions are matched before neutral formulae. The charge sign makes them
// unambiguous, and claiming "SO₄²⁻" whole stops the formula rule from taking
// the "SO₄" out of the middle of it and leaving the charge behind.
func ionRule() Rule {
	pattern := regexp.MustCompile(formulaLead + `(` + alternation(keysOf(ionNames)) + `)` + formulaTrail)
	return Rule{
		Name:    "chemistry.ion",
		Pattern: pattern,
		Expand: func(groups []string) string {
			if groups[3] != "" {
				return groups[0]
			}
			return groups[1] + ionNames[groups[2]]
		},
	}
}

// -------------------------------------------------------------------------- //
// Formulae
// -------------------------------------------------------------------------- //

// formulaNames maps a formula onto what a chemist calls it. Saying the name is
// both shorter and more useful than spelling out the atoms, and it is the one
// reading that cannot be misheard.
//
// Written with Unicode subscripts; the ASCII spellings ("H2SO4") are generated
// from these, so a new entry only has to be added once.
//
// Two entries that belong here are missing on purpose: bare CO and bare NO.
// Both are ordinary English words in the wrong context -- "NO" especially --
// and two capital letters carry nothing to tell them apart. The cost of leaving
// them out is close to zero, because Chinese notes almost always write the name
// beside the formula (「二氧化碳 CO₂」), so the listener has already heard it.
var formulaNames = map[string]string{
	"H₂O": "水", "H₂O₂": "过氧化氢",
	"CO₂": "二氧化碳", "O₂": "氧气", "H₂": "氢气", "N₂": "氮气",
	"Cl₂": "氯气", "O₃": "臭氧", "F₂": "氟气", "Br₂": "溴", "I₂": "碘",
	"H₂SO₄": "硫酸", "HCl": "盐酸", "HNO₃": "硝酸", "H₂CO₃": "碳酸",
	"H₃PO₄": "磷酸", "CH₃COOH": "醋酸", "HF": "氢氟酸", "H₂S": "硫化氢",
	"NH₃": "氨气", "CH₄": "甲烷", "C₂H₄": "乙烯", "C₂H₂": "乙炔",
	"C₂H₅OH": "乙醇", "CH₃OH": "甲醇", "C₆H₁₂O₆": "葡萄糖", "C₆H₆": "苯",
	"NaOH": "氢氧化钠", "KOH": "氢氧化钾", "Ca(OH)₂": "氢氧化钙",
	"Mg(OH)₂": "氢氧化镁", "Al(OH)₃": "氢氧化铝", "Fe(OH)₃": "氢氧化铁",
	"NaCl": "氯化钠", "KCl": "氯化钾", "CaCl₂": "氯化钙", "NH₄Cl": "氯化铵",
	"CaCO₃": "碳酸钙", "Na₂CO₃": "碳酸钠", "NaHCO₃": "碳酸氢钠",
	"KMnO₄": "高锰酸钾", "KClO₃": "氯酸钾",
	"CuSO₄": "硫酸铜", "ZnSO₄": "硫酸锌", "BaSO₄": "硫酸钡", "Na₂SO₄": "硫酸钠",
	"AgNO₃": "硝酸银", "AgCl": "氯化银",
	"Fe₂O₃": "三氧化二铁", "Fe₃O₄": "四氧化三铁", "Al₂O₃": "三氧化二铝",
	"MgO": "氧化镁", "CaO": "氧化钙", "CuO": "氧化铜", "SiO₂": "二氧化硅",
	"SO₂": "二氧化硫", "SO₃": "三氧化硫", "NO₂": "二氧化氮", "N₂O": "一氧化二氮",
}

// formulaLookup is formulaNames plus an ASCII-subscript spelling of every key,
// because a note may carry either and they are the same substance.
var formulaLookup = buildFormulaLookup()

func buildFormulaLookup() map[string]string {
	lookup := make(map[string]string, len(formulaNames)*2)
	for formula, name := range formulaNames {
		lookup[formula] = name
		if ascii := asciiDigits(formula, subscriptDigits); ascii != formula {
			lookup[ascii] = name
		}
	}
	return lookup
}

// elementSymbols is the periodic table, used only to decide whether a run of
// capitalised letters is a formula at all.
var elementSymbols = map[string]bool{}

func init() {
	for _, symbol := range strings.Fields(`
		H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca
		Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr
		Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe
		Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu
		Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn
		Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr
		Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og`) {
		elementSymbols[symbol] = true
	}
}

var elementPiece = regexp.MustCompile(`([A-Z][a-z]?)([0-9₀-₉]*)`)

// formulaRule handles both named and unnamed formulae, because deciding which
// one a token is has to happen after the token is whole.
//
// A named formula becomes its Chinese name. An unnamed one is spelled out
// letter by letter in English -- the user's choice -- so C₈H₁₀N₄O₂ becomes
// "C 8 H 10 N 4 O 2", the way it would be read at the board.
//
// Spelling out is the dangerous half, because acronyms have exactly this shape.
// Two independent conditions hold it back: every piece must be a real element
// symbol, and the token must contain at least one digit. "CPU" and "HTTP"
// survive the first test -- C, P, U, H, T and P are all elements -- and are
// rejected only by the second. "NASA" and "JSON" fail both.
func formulaRule() Rule {
	pattern := regexp.MustCompile(formulaLead + `([0-9]*)((?:` + formulaPiece + `)+)` + formulaTrail)
	return Rule{
		Name:    "chemistry.formula",
		Pattern: pattern,
		Expand: func(groups []string) string {
			lead, coefficient, token, trail := groups[1], groups[2], groups[3], groups[4]
			if trail != "" {
				return groups[0]
			}
			if name, known := formulaLookup[token]; known {
				return lead + coefficient + name
			}
			spoken, ok := spellFormula(token)
			if !ok {
				return groups[0]
			}
			return lead + coefficient + spoken
		},
	}
}

// spellFormula reports the letter-by-letter reading, and whether the token was
// a formula at all. A parenthesised group is left out of the spelled form: it
// only appears in compounds that have names, and reading brackets aloud helps
// nobody.
func spellFormula(token string) (string, bool) {
	if strings.ContainsAny(token, "()") {
		return "", false
	}
	pieces := elementPiece.FindAllStringSubmatch(token, -1)
	if len(pieces) < 2 {
		return "", false
	}
	spoken := make([]string, 0, len(pieces))
	consumed := 0
	hasDigit := false
	for _, piece := range pieces {
		if !elementSymbols[piece[1]] {
			return "", false
		}
		consumed += len(piece[0])
		element := piece[1]
		if piece[2] != "" {
			hasDigit = true
			element += " " + asciiDigits(piece[2], subscriptDigits)
		}
		spoken = append(spoken, element)
	}
	// A partial parse means the token held something that is not an element, so
	// it was never a formula.
	if consumed != len(token) || !hasDigit {
		return "", false
	}
	// Joined with a comma rather than a space, which is not cosmetic. A
	// space-joined "C 8 H 10 N 4" contains the sequences "8 H" and "10 N", and
	// the physics stage runs next and reads exactly that shape as a magnitude
	// followed by a unit -- caffeine came out as 「C 8亨利 10牛 4 O 2」, eight
	// henries and ten newtons. A comma never separates a number from its unit,
	// so it settles the ambiguity, and it gives the voice somewhere to breathe.
	return strings.Join(spoken, ", "), true
}
