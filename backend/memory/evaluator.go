package memory

import (
	"strings"
	"unicode"
)

func EvaluateAnswer(answer string, accepted []string) Evaluation {
	got := normalizeAnswer(answer)
	if got == "" {
		return Evaluation{Outcome: OutcomeIncorrect, Rating: RatingAgain, Feedback: "还没有作答；先说出一个答案，再看提示。"}
	}
	for _, expected := range accepted {
		for _, variant := range answerVariants(expected) {
			if got == variant {
				return Evaluation{Outcome: OutcomeCorrect, Rating: RatingGood, Feedback: "正确。这个记忆点可以进入下一轮间隔。"}
			}
		}
	}
	for _, expected := range accepted {
		variants := answerVariants(expected)
		for _, variant := range variants {
			if strings.Contains(variant, got) || strings.Contains(got, variant) {
				return Evaluation{Outcome: OutcomePartial, Rating: RatingHard, Feedback: "方向对了，但答案还不完整；补齐后再巩固一次。"}
			}
		}
	}
	return Evaluation{Outcome: OutcomeIncorrect, Rating: RatingAgain, Feedback: "这次没有命中；请对照标准答案并稍后再次尝试。"}
}

func normalizeAnswer(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		switch r {
		case '.', '。', ',', '，', '!', '！', '?', '？', ':', '：', ';', '；', '"', '\'', '(', ')', '[', ']', '{', '}':
			return -1
		default:
			return r
		}
	}, value)
	return value
}

func answerVariants(value string) []string {
	// Each accepted-answer entry is an alternative. Punctuation inside one
	// entry is kept as part of that answer, so a multi-part definition can be
	// graded as partial rather than incorrectly marked complete.
	if normalized := normalizeAnswer(value); normalized != "" {
		return []string{normalized}
	}
	return nil
}

// EvaluateFreeTextAnswer is the deterministic offline fallback for sentence
// building prompts. It cannot judge sentence quality, so any real attempt is
// recorded as partial until an online AI evaluation can replace it.
func EvaluateFreeTextAnswer(answer string) Evaluation {
	if strings.TrimSpace(answer) == "" {
		return Evaluation{
			Outcome:  OutcomeIncorrect,
			Rating:   RatingAgain,
			Feedback: "还没有作答；先写出一句完整的英文句子。",
		}
	}
	return Evaluation{
		Outcome:  OutcomePartial,
		Rating:   RatingHard,
		Feedback: "离线模式无法逐句评判，已记录你的答案并标记为部分掌握；联网后可获得 AI 批改。",
	}
}
