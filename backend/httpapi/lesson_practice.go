package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"study-os/backend/app"
	"study-os/backend/db"
	"study-os/backend/models"
)

const maxLessonPracticeBodyBytes = 64 << 10

func handleLessonPracticeAttemptCreate(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	var input struct {
		Answer     string `json:"answer"`
		QuestionID string `json:"question_id"`
		ElapsedMS  *int   `json:"elapsed_ms"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxLessonPracticeBodyBytes)
	if err := decodeRequest(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	answer := strings.TrimSpace(input.Answer)
	if answer == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "lesson practice answer is required"})
		return
	}
	elapsedMS := 0
	if input.ElapsedMS != nil {
		elapsedMS = *input.ElapsedMS
	}
	if elapsedMS < 0 {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "elapsed_ms must be non-negative"})
		return
	}

	lessonID := strings.TrimSpace(chi.URLParam(request, "lessonID"))
	sectionID := strings.TrimSpace(chi.URLParam(request, "sectionID"))
	lesson, section, err := getLessonPracticeSection(request, application, lessonID, sectionID)
	if err != nil {
		writeLessonPracticeError(response, err)
		return
	}
	questionID := strings.TrimSpace(input.QuestionID)
	evaluation, referenceAnswer, feedback, err := evaluateLessonPractice(section, questionID, answer)
	if err != nil {
		if errors.Is(err, errPracticeQuestionMissing) || errors.Is(err, errPracticeQuestionAmbiguous) {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": practiceQuestionMessage(err)})
			return
		}
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "evaluate lesson practice failed"})
		return
	}
	attempt := models.LessonPracticeAttempt{
		ID:              newRequestID("lesson-attempt"),
		LessonID:        lesson.ID,
		SectionID:       section.ID,
		QuestionID:      questionID,
		Answer:          answer,
		Evaluation:      evaluation,
		ReferenceAnswer: referenceAnswer,
		Feedback:        feedback,
		ElapsedMS:       elapsedMS,
		CreatedAt:       time.Now().UTC(),
	}
	if err := application.Store.CreateLessonPracticeAttempt(request.Context(), attempt); err != nil {
		writeLessonPracticeError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, attempt)
}

func handleLessonPracticeAttemptList(response http.ResponseWriter, request *http.Request, application *app.App) {
	if application == nil || application.Store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "application unavailable"})
		return
	}
	lessonID := strings.TrimSpace(chi.URLParam(request, "lessonID"))
	sectionID := strings.TrimSpace(chi.URLParam(request, "sectionID"))
	lesson, section, err := getLessonPracticeSection(request, application, lessonID, sectionID)
	if err != nil {
		writeLessonPracticeError(response, err)
		return
	}
	listOptions := models.LessonPracticeAttemptListOptions{
		Limit:      parseLimit(request.URL.Query().Get("limit"), 50, 100),
		Offset:     parseOffset(request.URL.Query().Get("offset")),
		QuestionID: strings.TrimSpace(request.URL.Query().Get("question_id")),
	}
	items, err := application.Store.ListLessonPracticeAttempts(request.Context(), lesson.ID, section.ID, listOptions)
	if err != nil {
		writeLessonPracticeError(response, err)
		return
	}
	// The same filter as the list: a total that ignores question_id would say "2"
	// above a list of one.
	total, err := application.Store.CountLessonPracticeAttempts(request.Context(), lesson.ID, section.ID, listOptions)
	if err != nil {
		writeLessonPracticeError(response, err)
		return
	}
	// The total, not the page: the panel prints it as "已作答 N 次".
	writeJSON(response, http.StatusOK, map[string]any{"items": items, "count": total})
}

func getLessonPracticeSection(request *http.Request, application *app.App, lessonID, sectionID string) (models.Lesson, models.LessonSection, error) {
	lesson, err := application.Store.GetLesson(request.Context(), lessonID)
	if err != nil {
		return models.Lesson{}, models.LessonSection{}, err
	}
	for _, section := range lesson.Document.Sections {
		if strings.TrimSpace(section.ID) == sectionID {
			return lesson, section, nil
		}
	}
	return models.Lesson{}, models.LessonSection{}, fmt.Errorf("lesson practice section %q: %w", sectionID, db.ErrNotFound)
}

// practiceQuestion is one question inside a practice section. A section that
// predates `questions` yields exactly one of these with an empty ID, which is how
// the single-question documents keep working untouched.
type practiceQuestion struct {
	ID      string
	Content map[string]any
}

// practiceQuestionsFromContent reads the questions of a practice section.
//
// `questions` wins when present. The flat fields (`question`, `options`,
// `correct_answer`…) are then read from the question itself and, for an older
// document, from the section: one code path, and the single-question shape is the
// degenerate case rather than a second implementation.
func practiceQuestionsFromContent(content map[string]any) []practiceQuestion {
	if items, ok := content["questions"].([]any); ok && len(items) > 0 {
		questions := make([]practiceQuestion, 0, len(items))
		for _, item := range items {
			entry, ok := item.(map[string]any)
			if !ok {
				continue
			}
			id, _ := entry["id"].(string)
			questions = append(questions, practiceQuestion{ID: strings.TrimSpace(id), Content: entry})
		}
		return questions
	}
	return []practiceQuestion{{Content: content}}
}

// practiceQuestionFor picks the question to grade. An empty id means "the only
// one": a section with several questions must say which, rather than have the
// server guess and file the answer under the wrong question.
func practiceQuestionFor(content map[string]any, questionID string) (practiceQuestion, error) {
	questions := practiceQuestionsFromContent(content)
	if len(questions) == 0 {
		return practiceQuestion{}, errPracticeQuestionMissing
	}
	if questionID == "" {
		if len(questions) > 1 {
			return practiceQuestion{}, errPracticeQuestionAmbiguous
		}
		return questions[0], nil
	}
	for _, question := range questions {
		if question.ID == questionID {
			return question, nil
		}
	}
	return practiceQuestion{}, errPracticeQuestionMissing
}

var (
	errPracticeQuestionMissing   = errors.New("lesson practice question not found")
	errPracticeQuestionAmbiguous = errors.New("lesson practice section has several questions")
)

// practiceQuestionMessage is what the writer of a question id sees. The reader of
// the page never sees these: the panel always sends the id it rendered.
func practiceQuestionMessage(err error) string {
	if errors.Is(err, errPracticeQuestionAmbiguous) {
		return "这一节有多道题，提交时请带 question_id 指明是第几题"
	}
	return "这道题不在这节课里"
}

func evaluateLessonPractice(section models.LessonSection, questionID, answer string) (string, string, string, error) {
	var rawContent any
	if len(section.Content) > 0 {
		if err := json.Unmarshal(section.Content, &rawContent); err != nil {
			return "", "", "", fmt.Errorf("decode lesson practice section: %w", err)
		}
	}
	content, ok := rawContent.(map[string]any)
	if !ok {
		// No content at all: nothing to grade, and nothing to look a question up
		// in -- the reader still gets the "compare it yourself" feedback.
		return models.LessonPracticeEvaluationUngraded, "", "暂无标准答案，请对照反馈复盘。", nil
	}
	question, err := practiceQuestionFor(content, strings.TrimSpace(questionID))
	if err != nil {
		return "", "", "", err
	}
	return evaluatePracticeContent(question.Content, answer)
}

func evaluatePracticeContent(content map[string]any, answer string) (string, string, string, error) {
	options := practiceOptionValues(content["options"])
	var expectedValue any
	for _, key := range []string{"correct_answer", "correctAnswer", "answer"} {
		if value, ok := content[key]; ok {
			expectedValue = value
			break
		}
	}
	expected := practiceAnswerValues(expectedValue, options)
	referenceAnswer := ""
	if len(expected) > 0 {
		referenceAnswer = expected[0]
	}

	evaluation := models.LessonPracticeEvaluationUngraded
	if len(expected) > 0 {
		evaluation = models.LessonPracticeEvaluationIncorrect
		for _, candidate := range expected {
			if strings.EqualFold(strings.TrimSpace(candidate), strings.TrimSpace(answer)) {
				evaluation = models.LessonPracticeEvaluationCorrect
				break
			}
		}
	}

	var feedback string
	switch evaluation {
	case models.LessonPracticeEvaluationCorrect:
		feedback = practiceFeedback(content, "correct_feedback", "correctFeedback", "feedback", "explanation")
		if feedback == "" {
			feedback = "回答正确。"
		}
	case models.LessonPracticeEvaluationIncorrect:
		feedback = practiceFeedback(content, "incorrect_feedback", "incorrectFeedback", "feedback", "explanation")
		if feedback == "" {
			feedback = "请检查题目条件后再试。"
		}
	default:
		feedback = practiceFeedback(content, "feedback", "explanation")
		if feedback == "" {
			feedback = "暂无标准答案，请对照反馈复盘。"
		}
	}
	return evaluation, referenceAnswer, feedback, nil
}

func practiceOptionValues(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	options := make([]string, 0, len(items))
	for _, item := range items {
		if text := practiceValueText(item); text != "" {
			options = append(options, text)
		}
	}
	return options
}

func practiceAnswerValues(value any, options []string) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case []any:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			values = append(values, practiceAnswerValues(item, options)...)
		}
		return values
	case map[string]any:
		for _, key := range []string{"value", "index", "answer", "correct_answer", "label", "text"} {
			if nested, ok := typed[key]; ok {
				return practiceAnswerValues(nested, options)
			}
		}
		return nil
	case float64:
		if math.Trunc(typed) == typed && len(options) > 0 {
			index := int(typed)
			if index >= 0 && index < len(options) {
				return []string{options[index]}
			}
			if index >= 1 && index <= len(options) {
				return []string{options[index-1]}
			}
		}
	}
	text := practiceValueText(value)
	if text == "" {
		return nil
	}
	if len(text) == 1 && len(options) > 0 {
		letter := strings.ToUpper(text)[0]
		index := int(letter - 'A')
		if index >= 0 && index < len(options) {
			return []string{options[index]}
		}
	}
	for _, option := range options {
		if strings.EqualFold(option, text) {
			return []string{option}
		}
	}
	return []string{text}
}

func practiceValueText(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case map[string]any:
		for _, key := range []string{"value", "label", "text", "body", "default", "title"} {
			if text := practiceValueText(typed[key]); text != "" {
				return text
			}
		}
	}
	return ""
}

func practiceFeedback(content map[string]any, keys ...string) string {
	for _, key := range keys {
		if text := practiceValueText(content[key]); text != "" {
			return text
		}
	}
	return ""
}

func writeLessonPracticeError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrNotFound):
		writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, db.ErrInvalidLessonPracticeAttempt):
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, db.ErrLessonPracticeAttemptAlreadyExists):
		writeJSON(response, http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "lesson practice operation failed"})
	}
}
