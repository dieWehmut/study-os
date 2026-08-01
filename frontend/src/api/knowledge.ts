import { apiRequest } from "./client"
import type { KnowledgeItem } from "./types"

export interface ListKnowledgeOptions {
  query?: string
  limit?: number
  offset?: number
}

export interface KnowledgeListResponse {
  items: KnowledgeItem[]
  count: number
}

export function listKnowledge(options: ListKnowledgeOptions = {}): Promise<KnowledgeListResponse> {
  const params = new URLSearchParams()
  if (options.query !== undefined) params.set("q", options.query)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  if (options.offset !== undefined) params.set("offset", String(options.offset))
  const suffix = params.toString()
  return apiRequest<KnowledgeListResponse>(`/knowledge${suffix ? `?${suffix}` : ""}`)
}

export function getKnowledge(id: string): Promise<KnowledgeItem> {
  return apiRequest<KnowledgeItem>(`/knowledge/${encodeURIComponent(id)}`)
}
