package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// DeepSeekProvider calls the DeepSeek Chat Completions endpoint through an
// OpenAI-compatible HTTP transport. Model names follow the current DeepSeek
// API: deepseek-v4-flash and deepseek-v4-pro (legacy aliases are deprecated).
type DeepSeekProvider struct {
	apiKey         string
	baseURL        string
	model          string
	reasoningModel string
	httpClient     *http.Client
}

type DeepSeekOption func(*DeepSeekProvider)

// WithHTTPClient injects a custom HTTP client (used by tests and future
// proxy setups). The default is http.DefaultClient.
func WithHTTPClient(client *http.Client) DeepSeekOption {
	return func(provider *DeepSeekProvider) {
		if client != nil {
			provider.httpClient = client
		}
	}
}

var _ Provider = (*DeepSeekProvider)(nil)

func NewDeepSeekProvider(cfg DeepSeekConfig, options ...DeepSeekOption) (*DeepSeekProvider, error) {
	if err := validateDeepSeekConfig(cfg); err != nil {
		return nil, err
	}
	provider := &DeepSeekProvider{
		apiKey:         strings.TrimSpace(cfg.APIKey),
		baseURL:        strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		model:          strings.TrimSpace(cfg.Model),
		reasoningModel: strings.TrimSpace(cfg.ReasoningModel),
		httpClient:     http.DefaultClient,
	}
	if provider.reasoningModel == "" {
		provider.reasoningModel = provider.model
	}
	for _, option := range options {
		if option != nil {
			option(provider)
		}
	}
	return provider, nil
}

func (p *DeepSeekProvider) Name() string {
	return "deepseek"
}

func (p *DeepSeekProvider) Generate(ctx context.Context, request Request) (Response, error) {
	if err := ctxErr(ctx); err != nil {
		return Response{}, err
	}
	if err := request.Validate(); err != nil {
		return Response{}, err
	}

	thinking, effort, err := normalizedOptions(request.Options)
	if err != nil {
		return Response{}, err
	}
	model := p.model
	if strings.TrimSpace(request.Options.Model) != "" {
		model = strings.TrimSpace(request.Options.Model)
	}
	body := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": deepSeekSystemPrompt(request.Kind)},
			{"role": "user", "content": deepSeekUserPrompt(request)},
		},
		"response_format": map[string]string{"type": "json_object"},
		"thinking":        map[string]string{"type": thinking},
		"stream":          false,
	}
	if thinking == "disabled" {
		body["temperature"] = 0.2
	} else if effort != "" {
		body["reasoning_effort"] = effort
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return Response{}, NewProviderError(ErrorPermanent, "encode DeepSeek request failed")
	}

	endpoint := p.baseURL + "/chat/completions"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return Response{}, NewProviderError(ErrorPermanent, "build DeepSeek request failed")
	}
	httpRequest.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")

	response, err := p.httpClient.Do(httpRequest)
	if err != nil {
		return Response{}, &ProviderError{
			Class:   ErrorTemporary,
			Message: "DeepSeek request failed",
			Cause:   err,
		}
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return Response{}, NewProviderError(ErrorTemporary, "read DeepSeek response failed")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Response{}, classifyDeepSeekHTTP(response.StatusCode, response.Header.Get("Retry-After"), responseBody)
	}

	var envelope struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(responseBody, &envelope); err != nil {
		return Response{}, NewProviderError(ErrorPermanent, "decode DeepSeek response failed")
	}
	content := ""
	if len(envelope.Choices) > 0 {
		content = strings.TrimSpace(envelope.Choices[0].Message.Content)
	}
	if content == "" {
		return Response{}, NewProviderError(ErrorPermanent, "DeepSeek returned an empty completion")
	}
	output, err := decodeDeepSeekOutput(request.Kind, content)
	if err != nil {
		return Response{}, NewProviderError(ErrorPermanent, err.Error())
	}
	return output, nil
}

func normalizedOptions(options Options) (string, string, error) {
	thinking := "disabled"
	switch strings.ToLower(strings.TrimSpace(options.Thinking)) {
	case "":
	case "enabled":
		thinking = "enabled"
	case "disabled":
		thinking = "disabled"
	default:
		return "", "", NewProviderError(ErrorPermanent, "thinking must be enabled or disabled")
	}
	effort := strings.ToLower(strings.TrimSpace(options.ReasoningEffort))
	switch effort {
	case "", "low", "high", "max":
	default:
		return "", "", NewProviderError(ErrorPermanent, "reasoning_effort must be low, high, or max")
	}
	return thinking, effort, nil
}

func classifyDeepSeekHTTP(status int, retryAfter string, body []byte) error {
	message := deepSeekErrorMessage(body)
	switch {
	case status == http.StatusTooManyRequests:
		var delay time.Duration
		if seconds, err := strconv.Atoi(strings.TrimSpace(retryAfter)); err == nil && seconds > 0 {
			delay = time.Duration(seconds) * time.Second
		}
		if message == "" {
			message = "DeepSeek rate limit exceeded"
		}
		return NewRateLimitError(message, delay)
	case status == http.StatusBadRequest || status == http.StatusUnauthorized ||
		status == http.StatusForbidden || status == http.StatusNotFound:
		if message == "" {
			message = "DeepSeek rejected the request"
		}
		return NewProviderError(ErrorPermanent, message)
	case status >= 500:
		if message == "" {
			message = "DeepSeek upstream unavailable"
		}
		return NewProviderError(ErrorTemporary, message)
	default:
		return NewProviderError(ErrorTemporary, "DeepSeek request failed")
	}
}

func deepSeekErrorMessage(body []byte) string {
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

func decodeDeepSeekOutput(kind Kind, content string) (Response, error) {
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
	default:
		return Response{}, NewProviderError(ErrorPermanent, "unsupported provider request kind")
	}
}

func deepSeekSystemPrompt(kind Kind) string {
	base := "你是高中自学系统 Study OS 的生成助手。只输出一个 JSON 对象，不要 Markdown 代码块、不要注释、不要任何额外文字。"
	switch kind {
	case KindMemoryQuestion:
		return base + " 输出字段：knowledge_id、prompt_type（en_to_zh/zh_to_en/context_cloze）、question、accepted_answers（字符串数组）、hint。"
	case KindFeedback:
		return base + " 输出字段：outcome（incorrect/partial/correct）、rating（整数 1/2/3，对应再次/困难/良好）、message（简短中文反馈）、sample_answer。"
	case KindSummary:
		return base + " 输出字段：title、key_points（字符串数组）、abstract。"
	case KindWordWiki:
		return base + " 输出字段：detailed_markdown（完整 Markdown，含释义、词族、搭配、例句、易混、记忆提示）、concise_definition、memory_tips、collocations、word_family。"
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
	default:
		return base
	}
}

func deepSeekUserPrompt(request Request) string {
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
		return fmt.Sprintf("term=%q\npart_of_speech=%q\ndefinition=%q\nexample=%q\nlevel=%q\ntags=%v\nsense_group=%q",
			input.Term, input.PartOfSpeech, input.Definition, input.Example, input.Level, input.Tags, input.SenseGroup)
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
	default:
		return "unknown request"
	}
}
