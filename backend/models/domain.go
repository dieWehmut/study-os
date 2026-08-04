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
	Limit   int
	Offset  int
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
