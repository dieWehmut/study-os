package models

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type Source struct {
	ID           string          `json:"id"`
	SourceType   string          `json:"source_type"`
	Name         string          `json:"name"`
	OriginalName string          `json:"original_name,omitempty"`
	MetadataJSON json.RawMessage `json:"metadata,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

type KnowledgeItem struct {
	ID                string    `json:"id"`
	SourceID          string    `json:"source_id,omitempty"`
	ItemType          string    `json:"item_type"`
	Term              string    `json:"term"`
	PartOfSpeech      string    `json:"part_of_speech,omitempty"`
	Pronunciation     string    `json:"pronunciation,omitempty"`
	ConciseDefinition string    `json:"concise_definition"`
	DetailedMarkdown  string    `json:"detailed_markdown,omitempty"`
	Example           string    `json:"example,omitempty"`
	Level             string    `json:"level,omitempty"`
	Subject           string    `json:"subject,omitempty"`
	Tags              []string  `json:"tags,omitempty"`
	Fingerprint       string    `json:"fingerprint,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type KnowledgeListOptions struct {
	Query   string
	Subject string
	Tag     string
	// Scheduled narrows to items that do or do not already carry review cards.
	// Nil means either, which is what every caller wanted before this existed --
	// so a field left unset cannot quietly hide half the library.
	Scheduled *bool
	Limit     int
	Offset    int
}

type KnowledgeGroup struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind,omitempty"`
	ParentID  string    `json:"parent_id,omitempty"`
	SortOrder int       `json:"sort_order,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AudioAsset struct {
	ID              string          `json:"id"`
	KnowledgeItemID string          `json:"knowledge_item_id"`
	SourceType      string          `json:"source_type"`
	URI             string          `json:"uri"`
	Attribution     string          `json:"attribution,omitempty"`
	Provider        string          `json:"provider,omitempty"`
	Voice           string          `json:"voice,omitempty"`
	TimelineJSON    json.RawMessage `json:"timeline,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
}

// VoiceRole is a saved 语音合成 persona: a name, a small avatar and a one-line
// bio wrapped around the endpoint settings that produce its voice. Roles exist
// so switching who reads a word aloud is one click rather than a settings edit.
//
// Only non-secret fields live here. A role may point at its own OpenAI-style
// server, but the credential stays in the local env file, because the database
// is backed up and exported while a key must not be.
type VoiceRole struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Bio  string `json:"bio,omitempty"`
	// AvatarPath is an absolute path on disk and never leaves the backend; the
	// UI reads the avatar through the role's avatar endpoint instead.
	AvatarPath string    `json:"-"`
	HasAvatar  bool      `json:"has_avatar"`
	Provider   string    `json:"provider,omitempty"`
	BaseURL    string    `json:"base_url,omitempty"`
	Model      string    `json:"model,omitempty"`
	Voice      string    `json:"voice,omitempty"`
	SortOrder  int       `json:"sort_order"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type ChatMessage struct {
	ID           string    `json:"id"`
	SessionID    string    `json:"session_id,omitempty"`
	Subject      string    `json:"subject,omitempty"`
	Role         string    `json:"role"`
	Content      string    `json:"content"`
	Status       string    `json:"status,omitempty"`
	ErrorSummary string    `json:"error_summary,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// Question is a 题目 -- the thing that was asked. It outlives any single
// attempt at it, because the same question gets attempted again after 订正.
type Question struct {
	ID       string `json:"id"`
	Subject  string `json:"subject,omitempty"`
	Stem     string `json:"stem"`
	SourceID string `json:"source_id,omitempty"`
	// KnowledgeItemID names the library entry this question was turned into,
	// empty until it has been. A link rather than a flag on purpose: "which
	// item" and "was it filed" then cannot drift apart.
	KnowledgeItemID string    `json:"knowledge_item_id,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

// QuestionAttempt is one 作答 of a Question. Cause carries the six-way error
// taxonomy from the Practice page; only some of those causes are ones that
// scheduling more review can actually fix.
type QuestionAttempt struct {
	ID         string    `json:"id"`
	QuestionID string    `json:"question_id"`
	Cause      string    `json:"cause,omitempty"`
	Note       string    `json:"note,omitempty"`
	Answer     string    `json:"answer,omitempty"`
	ElapsedMS  int       `json:"elapsed_ms"`
	IsCorrect  bool      `json:"is_correct"`
	OccurredAt time.Time `json:"occurred_at"`
}

// MistakeInput files one wrong answer: the question text and why it went
// wrong, in a single call, because a 错题 is only ever entered as a pair.
type MistakeInput struct {
	Subject    string `json:"subject,omitempty"`
	Stem       string `json:"stem"`
	Cause      string `json:"cause,omitempty"`
	Note       string `json:"note,omitempty"`
	Answer     string `json:"answer,omitempty"`
	ElapsedMS  int    `json:"elapsed_ms,omitempty"`
	OccurredAt time.Time
}

// MistakeCorrectionInput is the evidence submitted after a learner revisits
// a filed mistake. Unlike quick capture, correction requires an answer.
type MistakeCorrectionInput struct {
	Answer     string
	ElapsedMS  int
	OccurredAt time.Time
}

type MistakeListOptions struct {
	Subject string
	Limit   int
}

// Mistake pairs a Question with the attempt that got it wrong.
type Mistake struct {
	Question   Question         `json:"question"`
	Attempt    QuestionAttempt  `json:"attempt"`
	Correction *QuestionAttempt `json:"correction,omitempty"`
	// Corrected reports that this question has since been answered right.
	//
	// Derived from the existence of an attempt carrying no cause, never
	// stored: a flag sitting beside the rows it summarises is a second source
	// of truth, and the two drift the first time one write half-fails.
	Corrected bool `json:"corrected"`
}

type IntegratedNote struct {
	ID          string          `json:"id"`
	Subject     string          `json:"subject,omitempty"`
	Title       string          `json:"title"`
	SourceType  string          `json:"source_type,omitempty"`
	SourceID    string          `json:"source_id,omitempty"`
	MindmapJSON json.RawMessage `json:"mindmap"`
	CardsJSON   json.RawMessage `json:"cards"`
	CreatedAt   time.Time       `json:"created_at"`
}

// Lesson is a source-backed, learner-facing course unit. A lesson keeps the
// current document inline while lesson_versions stores the immutable history
// used to explain and reproduce edits.
type Lesson struct {
	ID             string         `json:"id"`
	Subject        string         `json:"subject,omitempty"`
	Title          string         `json:"title"`
	SourceType     string         `json:"source_type,omitempty"`
	SourceID       string         `json:"source_id,omitempty"`
	Status         string         `json:"status"`
	CurrentVersion int            `json:"version"`
	Document       LessonDocument `json:"document"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

// LessonSummary is returned by the collection endpoint so a library view does
// not need to download every section body. Details are available from GET by
// id (or by the version query parameter).
type LessonSummary struct {
	ID             string    `json:"id"`
	Subject        string    `json:"subject,omitempty"`
	Title          string    `json:"title"`
	SourceType     string    `json:"source_type,omitempty"`
	SourceID       string    `json:"source_id,omitempty"`
	Status         string    `json:"status"`
	CurrentVersion int       `json:"version"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// LessonVersion is an immutable document revision. The API exposes this shape
// when a historical version is requested explicitly.
type LessonVersion struct {
	LessonID      string         `json:"lesson_id"`
	Version       int            `json:"version"`
	SchemaVersion int            `json:"schema_version"`
	Document      LessonDocument `json:"document"`
	CreatedAt     time.Time      `json:"created_at"`
}

// LessonLink connects a lesson to a durable learning object. The target kind
// is deliberately explicit: a raw ID is not enough to tell a knowledge item
// from a memory prompt, and both may use unrelated ID namespaces.
type LessonLink struct {
	LessonID   string    `json:"lesson_id"`
	TargetType string    `json:"target_type"`
	TargetID   string    `json:"target_id"`
	CreatedAt  time.Time `json:"created_at"`
}

// LessonPracticeAttempt is the learner's observable answer to one structured
// practice section. It deliberately lives outside the memory attempt object:
// submitting a course question records evidence, but must not schedule an
// FSRS card.
type LessonPracticeAttempt struct {
	ID              string    `json:"id"`
	LessonID        string    `json:"lesson_id"`
	SectionID       string    `json:"section_id"`
	Answer          string    `json:"answer"`
	Evaluation      string    `json:"evaluation"`
	ReferenceAnswer string    `json:"reference_answer,omitempty"`
	Feedback        string    `json:"feedback"`
	ElapsedMS       int       `json:"elapsed_ms"`
	CreatedAt       time.Time `json:"created_at"`
}

type LessonPracticeAttemptListOptions struct {
	Limit  int
	Offset int
}

const (
	LessonPracticeEvaluationCorrect   = "correct"
	LessonPracticeEvaluationIncorrect = "incorrect"
	LessonPracticeEvaluationUngraded  = "ungraded"
)

var lessonPracticeEvaluations = map[string]struct{}{
	LessonPracticeEvaluationCorrect:   {},
	LessonPracticeEvaluationIncorrect: {},
	LessonPracticeEvaluationUngraded:  {},
}

func IsLessonPracticeEvaluationValid(evaluation string) bool {
	_, ok := lessonPracticeEvaluations[strings.TrimSpace(evaluation)]
	return ok
}

func (attempt LessonPracticeAttempt) Validate() error {
	if strings.TrimSpace(attempt.ID) == "" {
		return errors.New("lesson practice attempt id is required")
	}
	if strings.TrimSpace(attempt.LessonID) == "" {
		return errors.New("lesson practice attempt lesson id is required")
	}
	if strings.TrimSpace(attempt.SectionID) == "" {
		return errors.New("lesson practice attempt section id is required")
	}
	if strings.TrimSpace(attempt.Answer) == "" {
		return errors.New("lesson practice attempt answer is required")
	}
	if !IsLessonPracticeEvaluationValid(attempt.Evaluation) {
		return fmt.Errorf("lesson practice attempt evaluation %q is invalid", attempt.Evaluation)
	}
	if attempt.ElapsedMS < 0 {
		return errors.New("lesson practice attempt elapsed_ms must be non-negative")
	}
	return nil
}

type LessonLinkListOptions struct {
	TargetType string
	Limit      int
	Offset     int
}

const (
	LessonLinkTargetKnowledgeItem = "knowledge_item"
	LessonLinkTargetPrompt        = "prompt"
)

var lessonLinkTargetTypes = map[string]struct{}{
	LessonLinkTargetKnowledgeItem: {},
	LessonLinkTargetPrompt:        {},
}

func IsLessonLinkTargetValid(targetType string) bool {
	_, ok := lessonLinkTargetTypes[strings.TrimSpace(targetType)]
	return ok
}

// LessonDocument is deliberately data-oriented: section content is JSON so a
// later course renderer can add charts, questions, or media without changing
// the Lesson row. The section kinds and their order form the stable contract.
type LessonDocument struct {
	SchemaVersion int             `json:"schema_version"`
	Sections      []LessonSection `json:"sections"`
}

type LessonSection struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	Title    string          `json:"title"`
	Position int             `json:"position"`
	Required bool            `json:"required"`
	Content  json.RawMessage `json:"content"`
}

type LessonListOptions struct {
	Subject string
	Status  string
	Limit   int
	Offset  int
}

const (
	LessonStatusDraft     = "draft"
	LessonStatusReviewed  = "reviewed"
	LessonStatusPublished = "published"
	LessonStatusArchived  = "archived"
)

const LessonDocumentSchemaVersion = 1

var lessonSectionDefinitions = []struct {
	Type     string
	Title    string
	Required bool
}{
	{Type: "diagnostic", Title: "诊断", Required: true},
	{Type: "objectives", Title: "目标", Required: true},
	{Type: "concept", Title: "核心概念", Required: true},
	{Type: "examples", Title: "例题与示例", Required: true},
	{Type: "visualization", Title: "可视化", Required: true},
	{Type: "practice", Title: "即时练习", Required: true},
	{Type: "feedback", Title: "反馈", Required: true},
	{Type: "summary", Title: "总结", Required: true},
	{Type: "memory", Title: "记忆确认", Required: true},
	{Type: "follow_up", Title: "后续任务", Required: true},
}

var lessonStatuses = map[string]struct{}{
	LessonStatusDraft: {}, LessonStatusReviewed: {},
	LessonStatusPublished: {}, LessonStatusArchived: {},
}

// NewLessonDocument returns a complete, empty ten-section template.
func NewLessonDocument() LessonDocument {
	document := LessonDocument{SchemaVersion: LessonDocumentSchemaVersion, Sections: make([]LessonSection, 0, len(lessonSectionDefinitions))}
	for position, definition := range lessonSectionDefinitions {
		document.Sections = append(document.Sections, LessonSection{
			ID:       definition.Type,
			Type:     definition.Type,
			Title:    definition.Title,
			Position: position,
			Required: definition.Required,
			Content:  json.RawMessage(`{}`),
		})
	}
	return document
}

// NormalizeLessonDocument fills omitted template sections and rejects unknown
// or duplicate kinds. It keeps the persisted document deterministic, which is
// important for version comparisons and future renderer migrations.
func NormalizeLessonDocument(document LessonDocument) (LessonDocument, error) {
	if document.SchemaVersion == 0 {
		document.SchemaVersion = LessonDocumentSchemaVersion
	}
	if document.SchemaVersion != LessonDocumentSchemaVersion {
		return LessonDocument{}, fmt.Errorf("lesson document schema_version must be %d", LessonDocumentSchemaVersion)
	}
	provided := make(map[string]LessonSection, len(document.Sections))
	for _, section := range document.Sections {
		section.Type = strings.TrimSpace(section.Type)
		if section.Type == "" {
			return LessonDocument{}, errors.New("lesson section type is required")
		}
		if _, ok := lessonSectionDefinition(section.Type); !ok {
			return LessonDocument{}, fmt.Errorf("unknown lesson section type %q", section.Type)
		}
		if _, exists := provided[section.Type]; exists {
			return LessonDocument{}, fmt.Errorf("duplicate lesson section type %q", section.Type)
		}
		if strings.TrimSpace(section.ID) == "" {
			section.ID = section.Type
		}
		if len(section.Content) == 0 {
			section.Content = json.RawMessage(`{}`)
		} else if !json.Valid(section.Content) {
			return LessonDocument{}, fmt.Errorf("lesson section %q content is not valid JSON", section.Type)
		}
		provided[section.Type] = section
	}
	// Canonical ordering also makes a partial update safe: omitted sections are
	// retained as empty placeholders instead of silently changing the template.
	normalized := NewLessonDocument()
	for position := range normalized.Sections {
		section := normalized.Sections[position]
		if existing, ok := provided[section.Type]; ok {
			section.ID = existing.ID
			section.Title = strings.TrimSpace(existing.Title)
			if section.Title == "" {
				section.Title = normalized.Sections[position].Title
			}
			section.Content = append(json.RawMessage(nil), existing.Content...)
		}
		section.Position = position
		section.Required = true
		normalized.Sections[position] = section
	}
	return normalized, nil
}

func lessonSectionDefinition(sectionType string) (struct {
	Type     string
	Title    string
	Required bool
}, bool) {
	for _, definition := range lessonSectionDefinitions {
		if definition.Type == sectionType {
			return definition, true
		}
	}
	return struct {
		Type     string
		Title    string
		Required bool
	}{}, false
}

func IsLessonStatusValid(status string) bool {
	_, ok := lessonStatuses[strings.TrimSpace(status)]
	return ok
}

// EnglishArticle is a generated bilingual reading article. The list endpoint
// returns the same type with the large content fields left empty so callers
// can render a compact library without loading every article body.
type EnglishArticle struct {
	ID            string          `json:"id"`
	Title         string          `json:"title"`
	OriginalTitle string          `json:"original_title,omitempty"`
	Author        string          `json:"author,omitempty"`
	SourceName    string          `json:"source_name,omitempty"`
	SourceURL     string          `json:"source_url,omitempty"`
	PublishedAt   string          `json:"published_at,omitempty"`
	OriginalText  string          `json:"original_text,omitempty"`
	ContentJSON   json.RawMessage `json:"content,omitempty"`
	Markdown      string          `json:"markdown,omitempty"`
	Provider      string          `json:"provider,omitempty"`
	Model         string          `json:"model,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

type ChatAttachment struct {
	ID         string    `json:"id"`
	SessionID  string    `json:"session_id,omitempty"`
	Subject    string    `json:"subject,omitempty"`
	MessageID  string    `json:"message_id,omitempty"`
	Name       string    `json:"name"`
	StoredPath string    `json:"-"`
	SizeBytes  int64     `json:"size_bytes"`
	Kind       string    `json:"kind,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

type ChatConversation struct {
	SessionID    string    `json:"session_id"`
	Subject      string    `json:"subject,omitempty"`
	MessageCount int       `json:"message_count"`
	LastAt       time.Time `json:"last_at"`
	Title        string    `json:"title"`
	Preview      string    `json:"preview,omitempty"`
}

type Prompt struct {
	ID              string    `json:"id"`
	KnowledgeItemID string    `json:"knowledge_item_id"`
	PromptType      string    `json:"prompt_type"`
	Question        string    `json:"question"`
	AcceptedAnswers []string  `json:"accepted_answers"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type ReviewState struct {
	PromptID  string          `json:"prompt_id"`
	CardJSON  json.RawMessage `json:"card"`
	DueAt     time.Time       `json:"due_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

// ForecastDay is how many cards one day of the queue is holding.
//
// Date is a local calendar day (YYYY-MM-DD), not an instant: the question it
// answers is "what does Thursday look like", and Thursday is a thing on the
// learner's wall, not a UTC offset.
type ForecastDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type Attempt struct {
	ID                  string          `json:"id"`
	PromptID            string          `json:"prompt_id"`
	StudySessionID      string          `json:"study_session_id,omitempty"`
	Answer              string          `json:"answer"`
	OriginalEvaluation  string          `json:"original_evaluation"`
	EffectiveEvaluation string          `json:"effective_evaluation"`
	Feedback            string          `json:"feedback"`
	SchedulerRating     int             `json:"scheduler_rating"`
	PriorCardJSON       json.RawMessage `json:"prior_card"`
	Familiarity         *int            `json:"familiarity,omitempty"`
	CreatedAt           time.Time       `json:"created_at"`
	UpdatedAt           time.Time       `json:"updated_at"`
}

type AgentJob struct {
	ID           string          `json:"id"`
	JobType      string          `json:"job_type"`
	Provider     string          `json:"provider"`
	State        string          `json:"state"`
	PayloadJSON  json.RawMessage `json:"payload"`
	Attempts     int             `json:"attempts"`
	ErrorSummary string          `json:"error_summary,omitempty"`
	NextRetryAt  time.Time       `json:"next_retry_at,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

type DomainEvent struct {
	ID          string          `json:"id"`
	EventType   string          `json:"event_type"`
	AggregateID string          `json:"aggregate_id,omitempty"`
	PayloadJSON json.RawMessage `json:"payload"`
	OccurredAt  time.Time       `json:"occurred_at"`
}

type BackupRecord struct {
	ID        string    `json:"id"`
	Category  string    `json:"category"`
	Path      string    `json:"path"`
	SHA256    string    `json:"sha256"`
	SizeBytes int64     `json:"size_bytes"`
	CreatedAt time.Time `json:"created_at"`
}

// ImportJob records a server-owned staged import and its current workflow state.
type ImportJob struct {
	ID            string          `json:"id"`
	SourceID      string          `json:"source_id,omitempty"`
	StagedPath    string          `json:"-"`
	OriginalName  string          `json:"original_name,omitempty"`
	SelectedTable string          `json:"selected_table,omitempty"`
	MappingJSON   json.RawMessage `json:"mapping"`
	State         string          `json:"state"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

// ImportRow retains the source row and its normalized import decision.
type ImportRow struct {
	ID                    string          `json:"id"`
	ImportJobID           string          `json:"import_job_id"`
	RowNumber             int             `json:"row_number"`
	RawJSON               json.RawMessage `json:"raw"`
	NormalizedJSON        json.RawMessage `json:"normalized"`
	Disposition           string          `json:"disposition"`
	LinkedKnowledgeItemID string          `json:"linked_knowledge_item_id,omitempty"`
}

type DedupReview struct {
	ID                      string     `json:"id"`
	ImportRowID             string     `json:"import_row_id"`
	ExistingKnowledgeItemID string     `json:"existing_knowledge_item_id"`
	State                   string     `json:"state"`
	Resolution              string     `json:"resolution,omitempty"`
	CreatedAt               time.Time  `json:"created_at"`
	ResolvedAt              *time.Time `json:"resolved_at,omitempty"`
}
