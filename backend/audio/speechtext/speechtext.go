// Package speechtext rewrites notation into words a text-to-speech engine can
// actually pronounce.
//
// Speech engines read symbols badly, and they fail silently: a benchmark of the
// local IndexTTS2 voice showed superscripts, subscripts, unit symbols and the
// Unicode minus being dropped outright rather than mispronounced. "3×10⁸" came
// out as "3乘10" -- the exponent, and with it the entire order of magnitude,
// simply vanished. A listener has no way to notice that happened.
//
// So the text handed to a voice is not the text on screen. This package owns
// that translation. The note itself is never modified.
//
// Rules are data, not code: each domain contributes an ordered slice of Rule
// values, and adding a formula means adding a table row. Order across domains
// matters and is fixed in pipeline() -- see the comment there.
package speechtext

import (
	"regexp"
	"sort"
	"strings"
	"sync"
)

// Rule is one rewrite. Template is a regexp expansion string ("$1 volts");
// Expand handles the cases where the replacement depends on the captured text,
// and receives the submatches with index 0 holding the whole match.
type Rule struct {
	Name     string
	Pattern  *regexp.Regexp
	Template string
	Expand   func(groups []string) string
}

func (rule Rule) apply(text string) string {
	if rule.Expand == nil {
		return rule.Pattern.ReplaceAllString(text, rule.Template)
	}
	return replaceAllSubmatchFunc(text, rule.Pattern, rule.Expand)
}

// replaceAllSubmatchFunc is ReplaceAllStringFunc with access to the capture
// groups, which the standard library does not offer.
func replaceAllSubmatchFunc(text string, pattern *regexp.Regexp, expand func([]string) string) string {
	matches := pattern.FindAllStringSubmatchIndex(text, -1)
	if len(matches) == 0 {
		return text
	}
	var builder strings.Builder
	last := 0
	for _, match := range matches {
		groups := make([]string, len(match)/2)
		for index := range groups {
			start, end := match[2*index], match[2*index+1]
			if start >= 0 && end >= 0 {
				groups[index] = text[start:end]
			}
		}
		builder.WriteString(text[last:match[0]])
		builder.WriteString(expand(groups))
		last = match[1]
	}
	builder.WriteString(text[last:])
	return builder.String()
}

var (
	pipelineOnce  sync.Once
	compiledRules []Rule
)

// pipeline fixes the order every rule runs in. The ordering is the whole design
// and none of it is arbitrary:
//
//  1. LaTeX first, because it produces ordinary notation ("\alpha" -> "α") that
//     every later stage is written against. Running it late would mean teaching
//     every other rule to also recognise backslash commands.
//  2. Chemistry before math, because a formula is full of subscripts that the
//     math rules would otherwise shred: "H₂SO₄" must be matched whole, before
//     anything gets a chance to read "₂" as "subscript two".
//  3. Compound units before single units, so "m/s²" is read as one thing rather
//     than as a metre, a slash and a squared second.
//  4. Scientific notation before general superscripts, same reason.
//  5. Everything else, then polyphone fixes last, since those rewrite plain
//     Chinese and must not see half-translated notation.
func pipeline() []Rule {
	pipelineOnce.Do(func() {
		groups := [][]Rule{
			latexRules(),
			chemistryRules(),
			physicsRules(),
			mathRules(),
			abbreviationRules(),
			polyphoneRules(),
		}
		for _, group := range groups {
			compiledRules = append(compiledRules, group...)
		}
	})
	return compiledRules
}

// Normalize rewrites notation in text into pronounceable words. It is a no-op
// for prose that contains none, which is the common case, so it stays cheap for
// ordinary vocabulary terms.
func Normalize(text string) string {
	if text == "" {
		return ""
	}
	for _, rule := range pipeline() {
		text = rule.apply(text)
	}
	return collapseSpaces(text)
}

var spaceRun = regexp.MustCompile(`[ \t]{2,}`)

// collapseSpaces tidies the double spaces that replacements leave behind.
// Whitespace is not audible, but it does change the cache key, and two requests
// that differ only in spacing should not synthesise twice.
func collapseSpaces(text string) string {
	return strings.TrimSpace(spaceRun.ReplaceAllString(text, " "))
}

// alternation builds a regexp branch that matches any of keys, longest first.
// Go's regexp uses leftmost-first alternation, so without the length sort a
// short key would shadow a longer one that starts with it -- "m" would win over
// "mol" and every millimole would become a metre followed by "ol".
func alternation(keys []string) string {
	sorted := make([]string, len(keys))
	copy(sorted, keys)
	sort.Slice(sorted, func(i, j int) bool {
		if len(sorted[i]) != len(sorted[j]) {
			return len(sorted[i]) > len(sorted[j])
		}
		return sorted[i] < sorted[j]
	})
	quoted := make([]string, len(sorted))
	for index, key := range sorted {
		quoted[index] = regexp.QuoteMeta(key)
	}
	return strings.Join(quoted, "|")
}

// keysOf returns a map's keys. Callers feed it to alternation, which sorts, so
// the map's random iteration order does not leak into the compiled pattern.
func keysOf(table map[string]string) []string {
	keys := make([]string, 0, len(table))
	for key := range table {
		keys = append(keys, key)
	}
	return keys
}

// superscriptDigits and subscriptDigits map the Unicode forms onto ASCII so a
// single rule can handle "x²" and "10⁻³⁴" alike.
var superscriptDigits = map[rune]rune{
	'⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
	'⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
}

var subscriptDigits = map[rune]rune{
	'₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
	'₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
}

func asciiDigits(text string, table map[rune]rune) string {
	var builder strings.Builder
	for _, character := range text {
		if digit, ok := table[character]; ok {
			builder.WriteRune(digit)
			continue
		}
		builder.WriteRune(character)
	}
	return builder.String()
}
