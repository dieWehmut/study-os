import { apiRequest } from "./client"
import type { KnowledgeItem } from "./types"

export interface ListKnowledgeOptions {
  query?: string
  group?: string
  subject?: string
  tag?: string
  /**
   * Narrow to items that do ("yes") or do not ("no") already carry review
   * cards. Omitted means either -- the server rejects anything else, so the
   * union is deliberately not `string`.
   */
  scheduled?: "yes" | "no"
  limit?: number
  offset?: number
}

export interface KnowledgeListResponse {
  items: KnowledgeItem[]
  count: number
  /**
   * Which of the returned items already carry review cards. Optional because
   * an older backend answers without it, and a missing answer must not be read
   * as "queued" -- that would lock the control on every item in the library.
   */
  scheduled_ids?: string[]
}

export interface KnowledgeGroup {
  id: string
  name: string
  kind?: string
}

export interface KnowledgeGroupListResponse {
  items: KnowledgeGroup[]
  count: number
}

export function listKnowledge(options: ListKnowledgeOptions = {}): Promise<KnowledgeListResponse> {
  const params = new URLSearchParams()
  if (options.query !== undefined) params.set("q", options.query)
  if (options.group !== undefined) params.set("group", options.group)
  if (options.subject !== undefined) params.set("subject", options.subject)
  if (options.tag !== undefined) params.set("tag", options.tag)
  if (options.scheduled !== undefined) params.set("scheduled", options.scheduled)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  if (options.offset !== undefined) params.set("offset", String(options.offset))
  const suffix = params.toString()
  return apiRequest<KnowledgeListResponse>(`/knowledge${suffix ? `?${suffix}` : ""}`)
}

export function getKnowledge(id: string): Promise<KnowledgeItem> {
  return apiRequest<KnowledgeItem>(`/knowledge/${encodeURIComponent(id)}`)
}

export function listGroups(): Promise<KnowledgeGroupListResponse> {
  return apiRequest<KnowledgeGroupListResponse>("/groups")
}

/** The other items sharing a group with one item -- a word's 词族, in English. */
export interface RelatedKnowledge {
  items: KnowledgeItem[]
  groups: KnowledgeGroup[]
}

/**
 * Ask what else belongs with this item.
 *
 * Both arrays default to empty rather than staying undefined. A backend that
 * predates the endpoint, or a payload missing them, has to read as "no family"
 * -- the alternative is a section of the panel that spins forever on the
 * majority of items, which belong to no group at all.
 */
export async function listRelatedKnowledge(id: string): Promise<RelatedKnowledge> {
  const related = await apiRequest<Partial<RelatedKnowledge>>(
    `/knowledge/${encodeURIComponent(id)}/related`,
  )
  return { items: related.items ?? [], groups: related.groups ?? [] }
}

export interface ScheduleKnowledgeResponse {
  /**
   * "scheduled" when cards were just created, "already_scheduled" when the
   * item was in the queue before this request. The server answers both with
   * success, so the status is the only way to tell what actually happened.
   */
  status: "scheduled" | "already_scheduled"
  knowledge_id: string
  prompt_count: number
}

export function scheduleKnowledge(id: string): Promise<ScheduleKnowledgeResponse> {
  return apiRequest<ScheduleKnowledgeResponse>(`/knowledge/${encodeURIComponent(id)}/schedule`, {
    method: "POST",
  })
}
