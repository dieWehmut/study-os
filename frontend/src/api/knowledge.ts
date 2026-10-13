import { apiRequest, apiRequestText } from "./client"
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
  /**
   * Widen to 已归档 items as well ("yes"). Omitted means the default view, which hides
   * them -- deliberately the opposite default of `scheduled`, because everything you can
   * see should not have to ask for itself (ROADMAP §8.1).
   */
  archived?: "yes" | "no"
  limit?: number
  offset?: number
}

export interface KnowledgeListResponse {
  items: KnowledgeItem[]
  count: number
  /**
   * Which of the returned items are 已归档 (ROADMAP §8.1). Optional for the same reason as
   * `scheduled_ids` above: an older backend answers without it, and a missing answer must
   * not be read as none-of-them-are -- only `?archived=yes` ever makes it non-empty.
   */
  archived_ids?: string[]
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
  /** Items in the group, or -1 when the server could not count it. */
  item_count?: number
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
  // 归档 widens rather than filters: the list hides what was put away unless the caller
  // says "show me those too" (ROADMAP §8.1). Only "yes" is ever worth sending.
  if (options.archived !== undefined) params.set("archived", options.archived)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  if (options.offset !== undefined) params.set("offset", String(options.offset))
  const suffix = params.toString()
  return apiRequest<KnowledgeListResponse>(`/knowledge${suffix ? `?${suffix}` : ""}`)
}

export function getKnowledge(id: string): Promise<KnowledgeItem> {
  return apiRequest<KnowledgeItem>(`/knowledge/${encodeURIComponent(id)}`)
}

/**
 * The library as a file, in the column names 导入 reads.
 *
 * Plain text rather than JSON: the point of this button is a spreadsheet, and a
 * parsed object would have to be re-serialized exactly the way the importer
 * expects. The same filters as the list, so what leaves matches what is on screen.
 */
export async function exportKnowledge(
  options: { format?: "csv" | "jsonl"; query?: string; group?: string; subject?: string; tag?: string; scheduled?: "yes" | "no"; archived?: "yes" | "no" } = {},
): Promise<string> {
  const params = new URLSearchParams({ format: options.format ?? "csv" })
  if (options.query) params.set("q", options.query)
  if (options.group) params.set("group", options.group)
  if (options.subject) params.set("subject", options.subject)
  if (options.tag) params.set("tag", options.tag)
  if (options.scheduled) params.set("scheduled", options.scheduled)
  // 归档 widens the file the same way it widens the list: without this, exporting from a
  // 「显示已归档 · 开」 view handed over a smaller library than the screen was showing.
  if (options.archived) params.set("archived", options.archived)
  // apiRequestText, so this shares the client's one file-request path: the error
  // envelope is unwrapped, the desktop token travels with it, and the demo build
  // refuses here instead of at the button.
  return apiRequestText(`/knowledge/export?${params.toString()}`)
}

export type EnglishMasteryDimension = "recognition" | "comprehension" | "retrieval" | "use"
export type MasteryState = "missing" | "untested" | "self_reported" | "needs_work" | "partial" | "demonstrated"

export interface EnglishMasteryDimensionEvidence {
  dimension: EnglishMasteryDimension
  prompt_types: string[]
  state: MasteryState
  evidence_kind: "none" | "self_report" | "answer"
  prompt_count: number
  attempt_count: number
  latest_outcome?: string
  last_attempt_at?: string
  due_at?: string
}

export interface EnglishMasteryProjection {
  knowledge_item_id: string
  subject: string
  dimensions: EnglishMasteryDimensionEvidence[]
}

export function getKnowledgeMastery(id: string): Promise<EnglishMasteryProjection> {
  return apiRequest<EnglishMasteryProjection>(`/knowledge/${encodeURIComponent(id)}/mastery`)
}

export function listGroups(): Promise<KnowledgeGroupListResponse> {
  return apiRequest<KnowledgeGroupListResponse>("/groups")
}

/** The other items sharing a group with one item -- a word's 词族, in English. */
export interface RelatedKnowledge {
  items: KnowledgeItem[]
  groups: KnowledgeGroup[]
  /** Which of these siblings are 已归档 (§8.1). Optional: the Pages demo answers without it. */
  archived_ids?: string[]
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

export interface UnscheduleKnowledgeResponse {
  status: "unscheduled"
  knowledge_id: string
  /** How many schedules were removed. 0 is not an error: it was already out. */
  prompts_removed: number
}

/**
 * Take one item back out of the review queue.
 *
 * The cards and the attempts stay -- a card that was ever answered cannot be deleted at
 * all, and history is not what the undo is about. 排进复习 reuses those cards, so an item
 * can be put back exactly as it was.
 */
export function unscheduleKnowledge(id: string): Promise<UnscheduleKnowledgeResponse> {
  return apiRequest<UnscheduleKnowledgeResponse>(`/knowledge/${encodeURIComponent(id)}/schedule`, {
    method: "DELETE",
  })
}

export interface ArchiveKnowledgeResponse {
  status: "archived" | "unarchived"
  knowledge_id: string
}

/**
 * 归档 hides an item from the default library view; `unarchiveKnowledge` brings it back.
 *
 * Neither deletes anything: the item keeps its cards, its review states and every attempt,
 * and a link to it keeps working while archived (ROADMAP §8.1). That is why this is not
 * called "delete" anywhere -- and why the button sits next to 取消排复习 rather than
 * replacing it: one is "I do not want to see this", the other "I do not want to drill it".
 */
export function archiveKnowledge(id: string): Promise<ArchiveKnowledgeResponse> {
  return apiRequest<ArchiveKnowledgeResponse>(`/knowledge/${encodeURIComponent(id)}/archive`, {
    method: "POST",
  })
}

export function unarchiveKnowledge(id: string): Promise<ArchiveKnowledgeResponse> {
  return apiRequest<ArchiveKnowledgeResponse>(`/knowledge/${encodeURIComponent(id)}/archive`, {
    method: "DELETE",
  })
}

/**
 * Replace one item's wiki prose.
 *
 * The mindmap is re-derived from this markdown on every draw rather than stored
 * (0807:75), so this is the write behind editing a map: the shape follows the
 * source, and both come back identical on the next parse.
 *
 * Returns the saved item, so a caller can hand it straight to whatever holds
 * the list rather than re-fetching to find out what it just wrote.
 */
export function saveKnowledgeWiki(id: string, markdown: string): Promise<KnowledgeItem> {
  return apiRequest<KnowledgeItem>(`/knowledge/${encodeURIComponent(id)}/wiki`, {
    method: "PUT",
    body: JSON.stringify({ detailed_markdown: markdown }),
  })
}

export interface VocabularyLookupInput {
  term: string
  context: string
  kind: "word" | "expression"
}

export interface VocabularyLookupResponse {
  source: "existing" | "generated"
  item: KnowledgeItem
}

export function lookupVocabulary(input: VocabularyLookupInput): Promise<VocabularyLookupResponse> {
  return apiRequest<VocabularyLookupResponse>("/knowledge/lookup", {
    method: "POST",
    body: JSON.stringify(input),
  })
}
