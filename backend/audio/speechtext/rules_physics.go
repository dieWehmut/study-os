package speechtext

import (
	"regexp"
	"strings"
)

// physicsRules turns unit notation into the words a Chinese voice can actually
// say.
//
// One decision governs this whole file, and it is deliberately conservative: a
// unit symbol is expanded only when a number sits immediately in front of it.
// "220 V" is a voltage and becomes 220伏, while the V in "V = IR" is a variable
// and is left exactly as written. Nothing about the symbol itself can settle
// the question -- C is carbon, coulomb, capacitance and Celsius; T is tesla, a
// period and a matrix transpose; m is a metre and also the mass in every
// mechanics formula -- so the preceding number is the only evidence that a unit
// was meant at all. The asymmetry of the two failure modes decides the policy:
// a unit that goes unread costs the listener a small amount of polish, but a
// unit invented out of a variable name silently rewrites the physics, and the
// listener has no way to detect it. When in doubt this file does nothing.
//
// Compound units are the exception, because "m/s" and "J/(kg·K)" are not
// plausible variable names; they are matched with or without a leading number.
//
// The returned order is not negotiable -- see the comment on each group.
func physicsRules() []Rule {
	return []Rule{
		{
			// Compound units come first and are matched as one token. A
			// benchmark read "g = 9.8 m/s²" aloud as 「G等于每秒9.8米」: the word
			// order had inverted and the square was gone, because the pieces
			// were translated separately. Whole-token matching is the fix, and
			// it only works if nothing has already eaten the "m".
			Name:    "physics.compound-unit",
			Pattern: compoundUnitPattern,
			Expand:  unitExpander(compoundUnitWords),
		},
		{
			// The degree sign is self-identifying, so no number is required
			// here; the optional number is present only so that a leading minus
			// can be voiced as 负 rather than dropped.
			Name:    "physics.temperature",
			Pattern: temperaturePattern,
			Expand:  unitExpander(temperatureWords),
		},
		{
			// Kelvin is the opposite case: a bare K is far more likely to be a
			// constant, a key or a wavenumber than a temperature, so it obeys
			// the number rule. It runs before the single units so that it gets
			// first refusal on "300 K" while still declining "256 KB", which
			// the trailing-character guard rejects.
			Name:    "physics.kelvin",
			Pattern: kelvinPattern,
			Expand:  unitExpander(kelvinWords),
		},
		{
			Name:    "physics.unit",
			Pattern: singleUnitPattern,
			Expand:  unitExpander(singleUnitWords),
		},
		{
			// Constants are unambiguous glyphs rather than letters, so they need
			// no number in front. They run last because "N_A" would otherwise be
			// half-eaten by the newton in the single-unit table.
			Name:    "physics.constant",
			Pattern: constantPattern,
			Expand:  unitExpander(constantWords),
		},
	}
}

var (
	compoundUnitPattern = unitPattern(keysOf(compoundUnitWords), numberOptional)
	temperaturePattern  = unitPattern(keysOf(temperatureWords), numberOptional)
	kelvinPattern       = unitPattern(keysOf(kelvinWords), numberRequired)
	singleUnitPattern   = unitPattern(keysOf(singleUnitWords), numberRequired)
	constantPattern     = unitPattern(keysOf(constantWords), numberOptional)
)

// compoundUnitWords holds every unit that must survive as a single token. The
// slash has to become 每 in the right place, which is impossible once the parts
// have been translated on their own, so anything with a slash or a middle dot
// belongs here rather than in the single-unit table. Both the typographic and
// the ASCII spelling of an exponent are listed, since notes are written in both.
var compoundUnitWords = withLookalikes(map[string]string{
	"m/s":      "米每秒",
	"m/s²":     "米每二次方秒",
	"m/s^2":    "米每二次方秒",
	"km/h":     "千米每小时",
	"km/s":     "千米每秒",
	"kg/m³":    "千克每立方米",
	"kg/m^3":   "千克每立方米",
	"g/cm³":    "克每立方厘米",
	"g/cm^3":   "克每立方厘米",
	"J·s":      "焦耳秒",
	"N·m":      "牛顿米",
	"N·s":      "牛秒",
	"W/m²":     "瓦每平方米",
	"W/m^2":    "瓦每平方米",
	"W/(m·K)":  "瓦每米开尔文",
	"mol/L":    "摩尔每升",
	"g/mol":    "克每摩尔",
	"rad/s":    "弧度每秒",
	"N/m":      "牛每米",
	"J/(kg·K)": "焦耳每千克开尔文",
	"J/kg":     "焦耳每千克",
	"V/m":      "伏每米",
	"A/m²":     "安每平方米",
	"A/m^2":    "安每平方米",
	"kW·h":     "千瓦时",
	"Ω·m":      "欧姆米",
})

// temperatureWords covers the degree forms. The precomposed ℃ and ℉ are here
// because Chinese input methods emit them freely, and a voice that has never
// seen them simply says nothing.
var temperatureWords = withLookalikes(map[string]string{
	"°C": "摄氏度",
	"℃":  "摄氏度",
	"°F": "华氏度",
	"℉":  "华氏度",
})

var kelvinWords = withLookalikes(map[string]string{
	"K": "开尔文",
})

// singleUnitWords is matched case sensitively, and that is the entire point of
// the table. A benchmark read "200 mA" as 「200米A」 and "3.6 MJ" as 「3.6mJ」:
// milli and mega had been folded together, so a current became a length and a
// megajoule lost three orders of magnitude. Never add (?i) to the pattern built
// from these keys, and never add a key that differs from another only in case
// unless the two really are different units.
//
// Areas and volumes are listed as whole keys so that "5 m²" is a square metre
// rather than a metre followed by a loose exponent, but unlike the compound
// units they still demand a leading number, because a bare m² is much more
// likely to be a squared mass than an area.
var singleUnitWords = withLookalikes(map[string]string{
	// Length.
	"m":  "米",
	"km": "千米",
	"cm": "厘米",
	"mm": "毫米",
	"μm": "微米",
	"um": "微米",
	"nm": "纳米",
	"Å":  "埃",

	// Area and volume.
	"m²":  "平方米",
	"m^2": "平方米",
	"km²": "平方千米",
	"cm²": "平方厘米",
	"mm²": "平方毫米",
	"m³":  "立方米",
	"m^3": "立方米",
	"cm³": "立方厘米",

	// Time.
	"s":   "秒",
	"ms":  "毫秒",
	"μs":  "微秒",
	"ns":  "纳秒",
	"min": "分钟",
	"h":   "小时",

	// Mass.
	"g":  "克",
	"kg": "千克",
	"mg": "毫克",
	"t":  "吨",

	// Force, energy and power.
	"N":  "牛",
	"kN": "千牛",
	"J":  "焦耳",
	"kJ": "千焦",
	"MJ": "兆焦",
	"W":  "瓦",
	"kW": "千瓦",
	"MW": "兆瓦",

	// Pressure and frequency.
	"Pa":  "帕",
	"kPa": "千帕",
	"MPa": "兆帕",
	"Hz":  "赫兹",
	"kHz": "千赫",
	"MHz": "兆赫",
	"GHz": "吉赫",

	// Electricity and magnetism.
	"V":  "伏",
	"mV": "毫伏",
	"kV": "千伏",
	"A":  "安",
	"mA": "毫安",
	"μA": "微安",
	"uA": "微安",
	"Ω":  "欧姆",
	"kΩ": "千欧",
	"MΩ": "兆欧",
	"F":  "法拉",
	"μF": "微法",
	"uF": "微法",
	"pF": "皮法",
	"nF": "纳法",
	"H":  "亨利",
	"mH": "毫亨",
	"T":  "特斯拉",
	"Wb": "韦伯",
	"C":  "库仑",

	// Amount of substance, volume and light.
	"mol": "摩尔",
	"L":   "升",
	"mL":  "毫升",
	"cd":  "坎德拉",
	"lm":  "流明",
	"lx":  "勒克斯",

	// Radiation.
	"Bq":  "贝克勒尔",
	"Gy":  "戈瑞",
	"Sv":  "西弗",
	"eV":  "电子伏",
	"keV": "千电子伏",
	"MeV": "兆电子伏",

	// Ratios and angles.
	"dB":  "分贝",
	"rad": "弧度",

	// Digital storage, which shares the SI prefixes and so shares the trap.
	"B":  "字节",
	"KB": "千字节",
	"MB": "兆字节",
	"GB": "吉字节",
	"TB": "太字节",
})

// constantWords covers symbols that are never anything but themselves, which is
// why they are allowed to fire without a number in front.
var constantWords = withLookalikes(map[string]string{
	"ħ":   "约化普朗克常数",
	"ℏ":   "约化普朗克常数",
	"ε₀":  "真空介电常数",
	"ϵ₀":  "真空介电常数",
	"μ₀":  "真空磁导率",
	"N_A": "阿伏伽德罗常数",
	"Nₐ":  "阿伏伽德罗常数",
	"k_B": "玻尔兹曼常数",
	"k_b": "玻尔兹曼常数",
})

const (
	numberRequired = true
	numberOptional = false
)

// unitPattern assembles the shape every unit rule shares:
//
//	lead? sign? number? space? unit trail?
//
// The lead and trail groups exist because RE2 has neither lookbehind nor
// lookahead, so the only way to inspect the characters around a match is to
// capture them and put them back.
//
// The trailing group is what stops "200 mAh" from becoming 200毫安h and "256 KB"
// from being read as 256 kelvin followed by a stray B: if a letter, digit or
// underscore follows the unit then the symbol was part of a longer word and the
// rule declines.
//
// The leading group tells a negative sign apart from a subtraction. Ranges such
// as "20-30 °C" and "3-5 m" are ordinary in study notes, and voicing the hyphen
// there as 负 would invert the meaning, so a digit or letter captured in front
// of the sign demotes it back to a plain operator.
//
// That leading group is narrower when the number is optional, and the reason is
// worth recording. With an optional number a permissive lead may swallow the
// first letter of the unit itself: given "km/s", a lead of [A-Za-z] matches the
// k, no number follows, and the alternation then happily matches the remaining
// "m/s", yielding "k米每秒". Restricting the lead to a digit makes that
// impossible, since no unit symbol begins with one.
func unitPattern(units []string, requireNumber bool) *regexp.Regexp {
	const (
		signAndNumber = `([-−]?)([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)[ \x{00A0}]?`
		trailGuard    = `([0-9A-Za-z_]?)`
	)
	lead, number := `([0-9]?)`, `(?:`+signAndNumber+`)?`
	if requireNumber {
		lead, number = `([0-9A-Za-z]?)`, signAndNumber
	}
	// alternation sorts longest first, which is what keeps "mol" from being read
	// as a metre followed by "ol" and "m/s²" from collapsing to "m/s".
	return regexp.MustCompile(lead + number + `(` + alternation(units) + `)` + trailGuard)
}

// unitExpander rebuilds a match from its captures. It hands back the original
// text untouched whenever the trailing guard fired, which is how a rule opts out
// of a match it has already made.
func unitExpander(table map[string]string) func(groups []string) string {
	return func(groups []string) string {
		lead, sign, number, unit, trail := groups[1], groups[2], groups[3], groups[4], groups[5]
		word, known := table[unit]
		if !known || trail != "" {
			return groups[0]
		}
		var builder strings.Builder
		builder.WriteString(lead)
		switch {
		case sign == "":
			// Nothing to say.
		case lead != "":
			// Something ran straight into the sign, so it is an operator between
			// two values or the endpoints of a range, not the sign of a number.
			builder.WriteString(sign)
		default:
			builder.WriteString("负")
		}
		builder.WriteString(number)
		// The space between the number and the symbol is deliberately dropped:
		// "220 V" should be heard as one quantity, 220伏.
		builder.WriteString(word)
		return builder.String()
	}
}

// lookalikePairs are code points that render identically in a note but differ in
// storage. Which one a note contains depends on the editor, the input method and
// the site it was pasted from, and a table that knows only one of them fails on
// text that looks correct on screen -- the worst kind of bug to diagnose by ear.
var lookalikePairs = [][2]string{
	{"µ", "μ"}, // MICRO SIGN and GREEK SMALL LETTER MU.
	{"Ω", "Ω"}, // OHM SIGN and GREEK CAPITAL LETTER OMEGA.
	{"Å", "Å"}, // ANGSTROM SIGN and LATIN CAPITAL LETTER A WITH RING ABOVE.
	{"⋅", "·"}, // DOT OPERATOR and MIDDLE DOT.
}

// withLookalikes returns table with an extra key for every spelling variant of
// its existing keys, so callers can write whichever glyph reads best in source.
// It substitutes one pair at a time, which is enough because no unit symbol
// contains two of these characters at once.
func withLookalikes(table map[string]string) map[string]string {
	expanded := make(map[string]string, len(table))
	for key, word := range table {
		expanded[key] = word
		for _, pair := range lookalikePairs {
			if strings.Contains(key, pair[0]) {
				expanded[strings.ReplaceAll(key, pair[0], pair[1])] = word
			}
			if strings.Contains(key, pair[1]) {
				expanded[strings.ReplaceAll(key, pair[1], pair[0])] = word
			}
		}
	}
	return expanded
}
