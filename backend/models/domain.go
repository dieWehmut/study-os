package models

import (
	"encoding/json"
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
	OccurredAt time.Time `json:"occurred_at"`
}

// MistakeInput files one wrong answer: the question text and why it went
// wrong, in a single call, because a 错题 is only ever entered as a pair.
type MistakeInput struct {
	Subject    string `json:"subject,omitempty"`
	Stem       string `json:"stem"`
	Cause      string `json:"cause,omitempty"`
	Note       string `json:"note,omitempty"`
	OccurredAt time.Time
}

type MistakeListOptions struct {
	Subject string
	Limit   int
}

// Mistake pairs a Question with the attempt that got it wrong.
type Mistake struct {
	Question Question        `json:"question"`
	Attempt  QuestionAttempt `json:"attempt"`
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
