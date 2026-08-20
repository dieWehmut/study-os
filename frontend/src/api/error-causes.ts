import { apiRequest } from "./client"

export type ErrorCauseStatus = "candidate" | "confirmed" | "archived"

interface ErrorCauseWire {
  id: string
  subject?: string
  parent_id?: string
  label: string
  review_fixes: boolean
  action?: string
  status: ErrorCauseStatus
  source_type?: string
  source_id?: string
  sort_order: number
  created_at: string
  updated_at: string
}

interface ErrorCauseListWire {
  items: ErrorCauseWire[]
  count: number
}

export interface ErrorCause {
  id: string
  subject: string
  parentId?: string
  label: string
  reviewFixes: boolean
  action: string
  status: ErrorCauseStatus
  sourceType?: string
  sourceId?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ListErrorCausesOptions {
  subject?: string
  status?: ErrorCauseStatus | "all"
  limit?: number
  offset?: number
}

export interface CreateErrorCauseInput {
  id?: string
  subject?: string
  parentId?: string
  label: string
  reviewFixes?: boolean
  action?: string
  sourceType?: string
  sourceId?: string
  sortOrder?: number
}

export interface UpdateErrorCauseInput {
  parentId?: string
  label?: string
  reviewFixes?: boolean
  action?: string
  status?: ErrorCauseStatus
  sourceType?: string
  sourceId?: string
  sortOrder?: number
}

function normalizeErrorCause(cause: ErrorCauseWire): ErrorCause {
  return {
    id: cause.id,
    subject: cause.subject?.trim() ?? "",
    ...(cause.parent_id?.trim() ? { parentId: cause.parent_id } : {}),
    label: cause.label,
    reviewFixes: cause.review_fixes,
    action: cause.action?.trim() ?? "",
    status: cause.status,
    ...(cause.source_type?.trim() ? { sourceType: cause.source_type } : {}),
    ...(cause.source_id?.trim() ? { sourceId: cause.source_id } : {}),
    sortOrder: cause.sort_order,
    createdAt: cause.created_at,
    updatedAt: cause.updated_at,
  }
}

export async function listErrorCauses(options: ListErrorCausesOptions = {}): Promise<ErrorCause[]> {
  const params = new URLSearchParams()
  if (options.subject !== undefined) params.set("subject", options.subject)
  if (options.status !== undefined) params.set("status", options.status)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  if (options.offset !== undefined) params.set("offset", String(options.offset))
  const suffix = params.toString()
  const response = await apiRequest<ErrorCauseListWire>(`/error-causes${suffix ? `?${suffix}` : ""}`)
  return (response.items ?? []).map(normalizeErrorCause)
}

export async function createErrorCause(input: CreateErrorCauseInput): Promise<ErrorCause> {
  const wire = await apiRequest<ErrorCauseWire>("/error-causes", {
    method: "POST",
    body: JSON.stringify({
      ...(input.id !== undefined ? { id: input.id } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
      label: input.label,
      ...(input.reviewFixes !== undefined ? { review_fixes: input.reviewFixes } : {}),
      ...(input.action !== undefined ? { action: input.action } : {}),
      ...(input.sourceType !== undefined ? { source_type: input.sourceType } : {}),
      ...(input.sourceId !== undefined ? { source_id: input.sourceId } : {}),
      ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
    }),
  })
  return normalizeErrorCause(wire)
}

export async function updateErrorCause(id: string, input: UpdateErrorCauseInput): Promise<ErrorCause> {
  const wire = await apiRequest<ErrorCauseWire>(`/error-causes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.reviewFixes !== undefined ? { review_fixes: input.reviewFixes } : {}),
      ...(input.action !== undefined ? { action: input.action } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.sourceType !== undefined ? { source_type: input.sourceType } : {}),
      ...(input.sourceId !== undefined ? { source_id: input.sourceId } : {}),
      ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
    }),
  })
  return normalizeErrorCause(wire)
}
