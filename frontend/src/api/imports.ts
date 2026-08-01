import { apiRequest } from "./client"
import type {
  ImportCommitResponse,
  ImportInspection,
  ImportMapping,
  ImportPreview,
} from "./types"

export interface ImportUploadResponse {
  job_id: string
  inspection: ImportInspection
}

export function uploadImport(file: File, table?: string): Promise<ImportUploadResponse> {
  const body = new FormData()
  body.append("file", file)
  if (table) body.append("table", table)
  return apiRequest<ImportUploadResponse>("/imports", { method: "POST", body })
}

export function previewImport(jobId: string, mapping: ImportMapping): Promise<ImportPreview> {
  return apiRequest<ImportPreview>(`/imports/${encodeURIComponent(jobId)}/preview`, {
    method: "POST",
    body: JSON.stringify({ mapping }),
  })
}

export type ImportResolution = "merge" | "new_sense" | "reject"

export interface ImportCommitRequest {
  resolutions?: Record<string, ImportResolution>
}

export function commitImport(
  jobId: string,
  request: ImportCommitRequest = {},
): Promise<ImportCommitResponse> {
  return apiRequest<ImportCommitResponse>(`/imports/${encodeURIComponent(jobId)}/commit`, {
    method: "POST",
    body: JSON.stringify(request),
  })
}
