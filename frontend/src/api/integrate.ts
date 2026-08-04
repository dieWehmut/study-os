import { apiRequest } from "./client"

export interface MindNode {
  id: string
  label: string
  parent_id?: string
  node_type?: string
}

export interface MindMap {
  title: string
  nodes: MindNode[]
}

export interface IntegrateCard {
  id: string
  card_type: string
  title: string
  body: string
  tags?: string[]
}

export interface IntegratedNote {
  id: string
  subject?: string
  title: string
  source_type?: string
  source_id?: string
  mindmap: MindMap
  cards: IntegrateCard[]
  created_at: string
}

export interface IntegrateInput {
  subject: string
  title?: string
  text?: string
  knowledge_id?: string
  max_cards?: number
}

export function createIntegrate(input: IntegrateInput): Promise<IntegratedNote> {
  return apiRequest<IntegratedNote>("/integrate", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function listIntegrateNotes(subject: string, limit = 20): Promise<{ items: IntegratedNote[]; count: number }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (subject) params.set("subject", subject)
  return apiRequest<{ items: IntegratedNote[]; count: number }>(`/integrate?${params.toString()}`)
}

export function getIntegrateNote(id: string): Promise<IntegratedNote> {
  return apiRequest<IntegratedNote>(`/integrate/${encodeURIComponent(id)}`)
}
