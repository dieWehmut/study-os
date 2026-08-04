export interface KnowledgeItem {
  id: string
  item_type: string
  term: string
  part_of_speech?: string
  pronunciation?: string
  concise_definition: string
  detailed_markdown?: string
  example?: string
  level?: string
  subject?: string
  tags?: string[]
}

export interface ImportInspection {
  format: "csv" | "jsonl" | "sqlite"
  tables: string[]
  selected_table: string
  columns: string[]
  sample_rows: Array<Record<string, unknown>>
  row_count: number
}

export type ImportMapping = Record<string, string>

export interface ImportNormalizedCandidate {
  item_type?: string
  term: string
  definition: string
  part_of_speech?: string
  pronunciation?: string
  example?: string
  wiki?: string
  level?: string
  tags?: string[]
}

export type ImportDisposition = "insert" | "exact_duplicate" | "review" | "new_sense" | "invalid"

export interface ImportPreviewRow {
  row_id: string
  row_number: number
  raw: Record<string, unknown>
  normalized?: ImportNormalizedCandidate
  disposition: ImportDisposition
  matched_knowledge_item_id?: string
  error?: string
}

export interface ImportPreviewSummary {
  rows: number
  insert: number
  exact_duplicate: number
  review: number
  new_sense: number
  invalid: number
}

export interface ImportPreview {
  job_id: string
  state: string
  mapping: ImportMapping
  summary: ImportPreviewSummary
  rows: ImportPreviewRow[]
}

export interface ImportCommitSummary {
  inserted: number
  exact_duplicates: number
  merged: number
  pending_reviews: number
  rejected: number
  prompts_created: number
}

export interface ImportCommitResponse {
  job_id: string
  state: string
  summary: ImportCommitSummary
}

export interface ReviewPrompt {
  id: string
  knowledge_item_id: string
  prompt_type: string
  question: string
  options?: string[]
}

export interface ReviewKnowledge {
  id: string
  item_type: string
  part_of_speech?: string
  pronunciation?: string
  level?: string
  tags?: string[]
}

export interface DueReview {
  prompt: ReviewPrompt
  knowledge: ReviewKnowledge
  due_at: string
}

export interface DashboardData {
  knowledge_count: number
  prompt_count: number
  due_count: number
  attempt_count: number
  reviewed_today: number
  current_streak: number
  provider: string
  offline: boolean
  subjects_due?: Record<string, number>
  recent_items?: RecentKnowledgeItem[]
}

export interface RecentKnowledgeItem {
  id: string
  term: string
  item_type: string
  subject?: string
}

export interface ReviewEvaluation {
  attempt_id: string
  outcome: "incorrect" | "partial" | "correct"
  rating: 1 | 2 | 3
  feedback: string
  due_at: string
  expected_answers: string[]
}

export interface ChatMessage {
  id: string
  session_id?: string
  subject?: string
  role: string
  content: string
  status?: string
  error_summary?: string
  created_at: string
}

export interface CompareOutput {
  summary: string
  same_points?: string[]
  diff_points?: string[]
  confusion_point?: string
  memory_tip?: string
}
