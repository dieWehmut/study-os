import { apiRequest } from "./client"

/** The order is the course template, not the order in which an agent happened to write. */
export const LESSON_SECTION_ORDER = [
  "diagnostic",
  "objectives",
  "concept",
  "examples",
  "visualization",
  "practice",
  "feedback",
  "summary",
  "memory",
  "follow_up",
] as const

export type LessonSectionType = (typeof LESSON_SECTION_ORDER)[number] | (string & {})
export type LessonStatus = "draft" | "reviewed" | "published" | "archived" | (string & {})

export interface LessonSource {
  id?: string
  title?: string
  type?: string
  locator?: string
}

export interface LessonSection {
  id: string
  type?: LessonSectionType
  /** `kind` and the text fields are accepted while older lesson drafts migrate. */
  kind?: LessonSectionType
  title: string
  position?: number
  required?: boolean
  content?: unknown
  body?: string
  markdown?: string
  summary?: string
  items?: string[]
}

export interface LessonDocument {
  schema_version?: number
  sections: LessonSection[]
}

export interface Lesson {
  id: string
  title: string
  subject: string
  status: LessonStatus
  source_type?: string
  source_id?: string
  source?: LessonSource
  document?: LessonDocument
  sections: LessonSection[]
  objectives?: string[]
  estimated_minutes?: number
  sections_count?: number
  version?: number
  created_at?: string
  updated_at?: string
}

export interface LessonListOptions {
  subject?: string
  status?: LessonStatus
  limit?: number
  offset?: number
}

export interface LessonListResponse {
  items: Lesson[]
  count: number
}

interface RawLessonSection {
  id?: unknown
  title?: unknown
  type?: unknown
  kind?: unknown
  position?: unknown
  required?: unknown
  content?: unknown
  body?: unknown
  markdown?: unknown
  summary?: unknown
  items?: unknown
}

interface RawLesson {
  id?: unknown
  title?: unknown
  subject?: unknown
  status?: unknown
  source_type?: unknown
  source_id?: unknown
  source?: unknown
  objectives?: unknown
  estimated_minutes?: unknown
  sections_count?: unknown
  version?: unknown
  created_at?: unknown
  updated_at?: unknown
  document?: { schema_version?: unknown; sections?: unknown }
  sections?: unknown
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function normalizeSection(value: unknown, index: number): LessonSection {
  const raw = value && typeof value === "object" ? value as RawLessonSection : {}
  const type = text(raw.type) || text(raw.kind) || "concept"
  const title = text(raw.title) || type
  const section: LessonSection = {
    id: text(raw.id) || `${type}-${index + 1}`,
    title,
    type,
  }
  if (raw.kind) section.kind = text(raw.kind)
  if (typeof raw.position === "number") section.position = raw.position
  if (typeof raw.required === "boolean") section.required = raw.required
  if (raw.content !== undefined) section.content = raw.content
  if (typeof raw.body === "string") section.body = raw.body
  if (typeof raw.markdown === "string") section.markdown = raw.markdown
  if (typeof raw.summary === "string") section.summary = raw.summary
  if (Array.isArray(raw.items)) section.items = raw.items.filter((item): item is string => typeof item === "string")
  return section
}

/** Convert both the v1 document envelope and the first draft response shape. */
export function normalizeLesson(value: unknown): Lesson {
  const raw = value && typeof value === "object" ? value as RawLesson : {}
  const documentSections = raw.document?.sections
  const sectionsInput = Array.isArray(documentSections)
    ? documentSections
    : Array.isArray(raw.sections)
      ? raw.sections
      : []
  const sections = sectionsInput.map(normalizeSection)
  const sourceType = text(raw.source_type)
  const sourceID = text(raw.source_id)
  const lesson: Lesson = {
    id: text(raw.id) || "unknown-lesson",
    title: text(raw.title) || "未命名课程",
    subject: text(raw.subject) || "all",
    status: text(raw.status) || "draft",
    sections,
  }
  if (sourceType) lesson.source_type = sourceType
  if (sourceID) lesson.source_id = sourceID
  if (raw.source && typeof raw.source === "object") lesson.source = raw.source as LessonSource
  if (raw.document && typeof raw.document === "object") {
    lesson.document = { schema_version: typeof raw.document.schema_version === "number" ? raw.document.schema_version : undefined, sections }
  }
  if (Array.isArray(raw.objectives)) lesson.objectives = raw.objectives.filter((item): item is string => typeof item === "string")
  if (typeof raw.estimated_minutes === "number") lesson.estimated_minutes = raw.estimated_minutes
  if (typeof raw.version === "number") lesson.version = raw.version
  if (typeof raw.created_at === "string") lesson.created_at = raw.created_at
  if (typeof raw.updated_at === "string") lesson.updated_at = raw.updated_at
  lesson.sections_count = typeof raw.sections_count === "number" ? raw.sections_count : sections.length
  return lesson
}

function normalizeLessonSummary(value: unknown): Lesson {
  const lesson = normalizeLesson(value)
  if (!value || typeof value !== "object") {
    return { ...lesson, sections_count: LESSON_SECTION_ORDER.length }
  }

  const raw = value as RawLesson
  const hasEmbeddedSections = Array.isArray(raw.sections) || Array.isArray(raw.document?.sections)
  if (typeof raw.sections_count === "number" || hasEmbeddedSections) return lesson

  return { ...lesson, sections_count: LESSON_SECTION_ORDER.length }
}

export function listLessons(options: LessonListOptions = {}): Promise<LessonListResponse> {
  const params = new URLSearchParams()
  if (options.subject) params.set("subject", options.subject)
  if (options.status) params.set("status", options.status)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  if (options.offset !== undefined) params.set("offset", String(options.offset))
  const query = params.toString()
  return apiRequest<{ items?: unknown[]; count?: number }>(`/lessons${query ? `?${query}` : ""}`).then((result) => ({
    items: (result.items ?? []).map(normalizeLessonSummary),
    count: typeof result.count === "number" ? result.count : (result.items ?? []).length,
  }))
}

export function getLesson(id: string): Promise<Lesson> {
  return apiRequest<unknown>(`/lessons/${encodeURIComponent(id)}`).then(normalizeLesson)
}
