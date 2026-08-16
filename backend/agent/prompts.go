package agent

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// The prompt text and output decoding below are Study OS domain logic, not
// vendor logic: every provider sends the same instructions and parses the same
// JSON envelope. Keeping them here stops each new vendor from re-deriving them.

func providerErrorMessage(body []byte) string {
	var payload struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || strings.TrimSpace(payload.Error.Message) == "" {
		return ""
	}
	return strings.TrimSpace(payload.Error.Message)
}

func decodeProviderOutput(kind Kind, content string) (Response, error) {
	switch kind {
	case KindMemoryQuestion:
		var output MemoryQuestionOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil || strings.TrimSpace(output.Question) == "" {
			return Response{}, fmt.Errorf("model returned an invalid memory question")
		}
		return Response{Kind: kind, MemoryQuestion: &output}, nil
	case KindFeedback:
		var output FeedbackOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil || strings.TrimSpace(output.Message) == "" {
			return Response{}, fmt.Errorf("model returned an invalid feedback evaluation")
		}
		return Response{Kind: kind, Feedback: &output}, nil
	case KindSummary:
		var output SummaryOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil {
			return Response{}, fmt.Errorf("model returned an invalid summary")
		}
		return Response{Kind: kind, Summary: &output}, nil
	case KindWordWiki:
		var output WordWikiOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil || strings.TrimSpace(output.DetailedMarkdown) == "" {
			return Response{}, fmt.Errorf("model returned an invalid word wiki")
		}
		return Response{Kind: kind, WordWiki: &output}, nil
	case KindMakeSentence:
		var output SentenceOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil || strings.TrimSpace(output.Sentence) == "" {
			return Response{}, fmt.Errorf("model returned an invalid sentence")
		}
		return Response{Kind: kind, Sentence: &output}, nil
	case KindEvaluateFreeText:
		var output FeedbackOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil || strings.TrimSpace(output.Message) == "" {
			return Response{}, fmt.Errorf("model returned an invalid free text evaluation")
		}
		return Response{Kind: kind, Feedback: &output}, nil
	case KindExtractMemoryPoints:
		var output ExtractOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil {
			return Response{}, fmt.Errorf("model returned invalid memory points")
		}
		return Response{Kind: kind, Extract: &output}, nil
	case KindCompressSenses:
		var output CompressOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil || len(output.Groups) == 0 {
			return Response{}, fmt.Errorf("model returned invalid sense groups")
		}
		return Response{Kind: kind, Compress: &output}, nil
	case KindChat:
		var output ChatOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil || strings.TrimSpace(output.Answer) == "" {
			return Response{}, fmt.Errorf("model returned an invalid chat answer")
		}
		return Response{Kind: kind, Chat: &output}, nil
	case KindCompare:
		var output CompareOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil || strings.TrimSpace(output.Summary) == "" {
			return Response{}, fmt.Errorf("model returned an invalid comparison")
		}
		return Response{Kind: kind, Compare: &output}, nil
	case KindIntegrate:
		var output IntegrateOutput
		if err := json.Unmarshal([]byte(content), &output); err != nil || strings.TrimSpace(output.Map.Title) == "" || len(output.Map.Nodes) == 0 {
			return Response{}, fmt.Errorf("model returned an invalid integration")
		}
		return Response{Kind: kind, Integrate: &output}, nil
	case KindEnglishArticle:
		var output EnglishArticleOutput
		if err := decodeStrictJSON(content, &output); err != nil || strings.TrimSpace(output.Title) == "" || len(output.Sections) == 0 {
			return Response{}, fmt.Errorf("model returned an invalid English article")
		}
		return Response{Kind: kind, EnglishArticle: &output}, nil
	default:
		return Response{}, NewProviderError(ErrorPermanent, "unsupported provider request kind")
	}
}

func decodeStrictJSON(content string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(content))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("JSON must contain one value")
		}
		return err
	}
	return nil
}

func systemPromptFor(kind Kind) string {
	base := "你是高中自学系统 Study OS 的生成助手。只输出一个 JSON 对象，不要 Markdown 代码块、不要注释、不要任何额外文字。"
	switch kind {
	case KindMemoryQuestion:
		return base + " 输出字段：knowledge_id、prompt_type（en_to_zh/zh_to_en/context_cloze）、question、accepted_answers（字符串数组）、hint。"
	case KindFeedback:
		return base + " 输出字段：outcome（incorrect/partial/correct）、rating（整数 1/2/3，对应再次/困难/良好）、message（简短中文反馈）、sample_answer。"
	case KindSummary:
		return base + " 输出字段：title、key_points（字符串数组）、abstract。"
	case KindWordWiki:
		// The three list fields say「字符串数组」for the same reason key_points
		// above does: unannotated, a model with one tip to give writes a
		// sentence. stringList now survives that, but the prompt should not
		// invite the ambiguity in the first place.
		//
		// The heading rule is not cosmetic: detailed_markdown is the sole input
		// to 生成导图, and 0807:75 says a markdown wiki needs no model to become
		// a map, only a parser. A wiki written as one unbroken block parses to a
		// root with no branches -- nothing to draw. Asking for ### sections is
		// what makes the same text readable as prose *and* as a shape.
		return base + " 输出字段：detailed_markdown（完整 Markdown）、concise_definition、memory_tips（字符串数组）、collocations（字符串数组）、word_family（字符串数组）。" +
			"detailed_markdown 首行用「## 词条名」，正文按「### 释义」「### 词族」「### 搭配」「### 例句」「### 易混」「### 记忆提示」分节，每节 2-4 行；这样它同时是一张导图的骨架。"
	case KindMakeSentence:
		return base + " 输出字段：sentence（包含目标词的英文句子）、translation（中文翻译）、blanked（用 _____ 替换目标词）。"
	case KindEvaluateFreeText:
		return base + " 输出字段：outcome（incorrect/partial/correct）、rating（整数 1/2/3）、message（简短中文反馈，指出优缺点）、sample_answer（参考答案）。"
	case KindExtractMemoryPoints:
		return base + " 输出字段：points（数组，每项含 term、definition、item_type、level、tags）。只抽取值得记忆的内容，不要逻辑推理题。"
	case KindCompressSenses:
		return base + " 输出字段：groups（数组，每项含 name、sense_indexes（对应输入序号）、merged_definition）。把同核义项合并成更少的分组。"
	case KindChat:
		return base + " 你是学科答疑助手，回答要准确、简洁、分点，适合自学。输出字段：answer（完整回答，可含 Markdown 列表）。"
	case KindCompare:
		return base + " 输出字段：summary（一句话总对比）、same_points（相同点数组）、diff_points（不同点数组，逐条说明）、confusion_point（最易混点）、memory_tip（记忆口诀/提示）。"
	case KindIntegrate:
		return base + " 你负责把资料整理成「导图 + 卡片」。输出字段：mindmap（{title, nodes:[{id,label,parent_id,node_type}]}）、cards（数组，每项 {id,card_type,title,body,tags}）。" +
			"质量规则：每个节点 label 不超过 20 字；一张卡片只讲一个主题，body 用 2-4 个短句；层级不超过 3 层；node_type 取值 root/branch/leaf/conclusion/trap（二级结论用 conclusion，易错信号用 trap）。"
	case KindEnglishArticle:
		return "You create a faithful bilingual English-study article for Study OS. Return exactly one JSON object with fields title, metadata, and sections. " +
			"metadata contains original_title, author, source_name, source_url, and published_at. Each section contains title, paragraphs, and vocabulary. " +
			"Each paragraph contains segments (objects with text and emphasized) and translation. Each vocabulary item contains term, british_phonetic, american_phonetic, part_of_speech, definition, usage, and examples. " +
			"Preserve source facts, argument order, and complete English meaning. Every translation must be faithful natural Chinese. Emphasize only useful learning phrases, and every emphasized segment must be copied verbatim from its English paragraph. Output strict JSON only, with no Markdown fences, HTML, commentary, or extra text."
	default:
		return base
	}
}

func userPromptFor(request Request) string {
	switch request.Kind {
	case KindMemoryQuestion:
		input := request.Knowledge
		return fmt.Sprintf("term=%q\ndefinition=%q\nexample=%q\nprompt_type=%q\naccepted_answers=%v",
			input.Term, input.Definition, input.Example, input.PromptType, input.AcceptedAnswers)
	case KindFeedback:
		input := request.Feedback
		return fmt.Sprintf("answer=%q\naccepted_answers=%v", input.Answer, input.AcceptedAnswers)
	case KindSummary:
		input := request.Summary
		return fmt.Sprintf("title=%q\nmax_key_points=%d\ntext=%q", input.Title, input.MaxKeyPoints, input.Text)
	case KindWordWiki:
		input := request.WordWiki
		return fmt.Sprintf("term=%q\ncontext=%q\npart_of_speech=%q\ndefinition=%q\nexample=%q\nlevel=%q\ntags=%v\nsense_group=%q",
			input.Term, input.Context, input.PartOfSpeech, input.Definition, input.Example, input.Level, input.Tags, input.SenseGroup)
	case KindMakeSentence:
		input := request.Sentence
		return fmt.Sprintf("term=%q\ndefinition=%q\nexample=%q\nlevel=%q", input.Term, input.Definition, input.Example, input.Level)
	case KindEvaluateFreeText:
		input := request.FreeText
		return fmt.Sprintf("prompt_type=%q\nquestion=%q\nanswer=%q\naccepted_answers=%v\ncriteria=%q",
			input.PromptType, input.Question, input.Answer, input.AcceptedAnswers, input.Criteria)
	case KindExtractMemoryPoints:
		input := request.Extract
		return fmt.Sprintf("title=%q\nsubject=%q\nmax_points=%d\ntext=%q", input.Title, input.Subject, input.MaxPoints, input.Text)
	case KindCompressSenses:
		input := request.Compress
		encoded, _ := json.Marshal(input.Senses)
		return fmt.Sprintf("term=%q\nsenses=%s", input.Term, string(encoded))
	case KindChat:
		input := request.Chat
		history := ""
		for _, turn := range input.History {
			history += turn.Role + ": " + turn.Content + "\n"
		}
		return fmt.Sprintf("subject=%q\nhistory:\n%s\nuser_question=%q", input.Subject, history, input.Prompt)
	case KindCompare:
		input := request.Compare
		return fmt.Sprintf("subject=%q\nterm_a=%q\nterm_b=%q", input.Subject, input.TermA, input.TermB)
	case KindIntegrate:
		input := request.Integrate
		return fmt.Sprintf("subject=%q\ntitle=%q\nmax_cards=%d\ntext=%q", input.Subject, input.Title, input.MaxCards, input.Text)
	case KindEnglishArticle:
		input := request.EnglishArticle
		encoded, _ := json.Marshal(input)
		return "User-supplied source and metadata (explicit metadata must take precedence over inferred values):\n" + string(encoded)
	default:
		return "unknown request"
	}
}
