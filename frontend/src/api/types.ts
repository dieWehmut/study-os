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
  tags?: string[]
}

export interface ReviewPrompt {
  id: string
  knowledge_item_id: string
  prompt_type: string
  question: string
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
}

export interface ReviewEvaluation {
  attempt_id: string
  outcome: "incorrect" | "partial" | "correct"
  rating: 1 | 2 | 3
  feedback: string
  due_at: string
  expected_answers: string[]
}
