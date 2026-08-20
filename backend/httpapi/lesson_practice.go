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
		Answer    string `json:"answer"`
		ElapsedMS *int   `json:"elapsed_ms"`
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
	evaluation, referenceAnswer, feedback, err := evaluateLessonPractice(section, answer)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "evaluate lesson practice failed"})
		return
	}
	attempt := models.LessonPracticeAttempt{
		ID:              newRequestID("lesson-attempt"),
		LessonID:        lesson.ID,
		SectionID:       section.ID,
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
	items, err := application.Store.ListLessonPracticeAttempts(request.Context(), lesson.ID, section.ID,
		models.LessonPracticeAttemptListOptions{
			Limit:  parseLimit(request.URL.Query().Get("limit"), 50, 100),
			Offset: parseOffset(request.URL.Query().Get("offset")),
		})
	if err != nil {
		writeLessonPracticeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": items, "count": len(items)})
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

func evaluateLessonPractice(section models.LessonSection, answer string) (string, string, string, error) {
	var rawContent any
	if len(section.Content) > 0 {
		if err := json.Unmarshal(section.Content, &rawContent); err != nil {
			return "", "", "", fmt.Errorf("decode lesson practice section: %w", err)
		}
	}
	content, ok := rawContent.(map[string]any)
	if !ok {
		return models.LessonPracticeEvaluationUngraded, "", "暂无标准答案，请对照反馈复盘。", nil
	}
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
