CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE knowledge_items (
    id TEXT PRIMARY KEY,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    item_type TEXT NOT NULL,
    term TEXT NOT NULL,
    part_of_speech TEXT NOT NULL DEFAULT '',
    pronunciation TEXT NOT NULL DEFAULT '',
    concise_definition TEXT NOT NULL,
    detailed_markdown TEXT NOT NULL DEFAULT '',
    example TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    fingerprint TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX knowledge_items_term_idx ON knowledge_items(term);
CREATE INDEX knowledge_items_fingerprint_idx ON knowledge_items(fingerprint);

CREATE TABLE prompts (
    id TEXT PRIMARY KEY,
    knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    prompt_type TEXT NOT NULL,
    question TEXT NOT NULL,
    accepted_answers_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX prompts_knowledge_item_idx ON prompts(knowledge_item_id);

CREATE TABLE review_states (
    prompt_id TEXT PRIMARY KEY REFERENCES prompts(id) ON DELETE CASCADE,
    card_json TEXT NOT NULL,
    due_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX review_states_due_at_idx ON review_states(due_at);

CREATE TABLE study_sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    summary_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE attempts (
    id TEXT PRIMARY KEY,
    prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE RESTRICT,
    study_session_id TEXT REFERENCES study_sessions(id) ON DELETE SET NULL,
    answer TEXT NOT NULL,
    original_evaluation TEXT NOT NULL,
    effective_evaluation TEXT NOT NULL,
    feedback TEXT NOT NULL DEFAULT '',
    scheduler_rating INTEGER NOT NULL,
    prior_card_json TEXT NOT NULL,
    familiarity INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX attempts_prompt_idx ON attempts(prompt_id, created_at DESC);

CREATE TABLE agent_jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    next_retry_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX agent_jobs_queue_idx ON agent_jobs(state, next_retry_at, created_at);

CREATE TABLE domain_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL
);
CREATE INDEX domain_events_time_idx ON domain_events(occurred_at DESC);

CREATE TABLE import_jobs (
    id TEXT PRIMARY KEY,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    staged_path TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    selected_table TEXT NOT NULL DEFAULT '',
    mapping_json TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE import_rows (
    id TEXT PRIMARY KEY,
    import_job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    raw_json TEXT NOT NULL,
    normalized_json TEXT NOT NULL DEFAULT '{}',
    disposition TEXT NOT NULL DEFAULT 'pending',
    linked_knowledge_item_id TEXT REFERENCES knowledge_items(id) ON DELETE SET NULL
);

CREATE TABLE dedup_reviews (
    id TEXT PRIMARY KEY,
    import_row_id TEXT NOT NULL REFERENCES import_rows(id) ON DELETE CASCADE,
    existing_knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'pending',
    resolution TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE TABLE audio_assets (
    id TEXT PRIMARY KEY,
    knowledge_item_id TEXT REFERENCES knowledge_items(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    uri TEXT NOT NULL,
    attribution TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    voice TEXT NOT NULL DEFAULT '',
    timeline_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE knowledge_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT '',
    parent_id TEXT REFERENCES knowledge_groups(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX knowledge_groups_parent_idx ON knowledge_groups(parent_id);

CREATE TABLE knowledge_item_groups (
    knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES knowledge_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (knowledge_item_id, group_id)
);
CREATE INDEX knowledge_item_groups_group_idx ON knowledge_item_groups(group_id);

CREATE TABLE backup_records (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX chat_messages_subject_idx ON chat_messages(subject, created_at DESC);

CREATE TABLE integrated_notes (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL DEFAULT '',
    mindmap_json TEXT NOT NULL DEFAULT '{}',
    cards_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE INDEX integrated_notes_subject_idx ON integrated_notes(subject, created_at DESC);

CREATE TABLE chat_attachments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    message_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX chat_attachments_session_idx ON chat_attachments(session_id, created_at DESC);

CREATE TABLE questions (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL DEFAULT '',
    stem TEXT NOT NULL,
    source_id TEXT NOT NULL DEFAULT '',
    knowledge_item_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX questions_subject_idx ON questions(subject, created_at DESC);

CREATE TABLE question_attempts (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    cause TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL
);
CREATE INDEX question_attempts_question_idx ON question_attempts(question_id, occurred_at DESC);
