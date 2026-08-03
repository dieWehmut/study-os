import { apiRequest } from "./client"

export interface UpdateStatus {
  current_version: string
  latest_version?: string
  update_available: boolean
  release_notes?: string
  release_url?: string
  asset_name?: string
  checked_at?: string
  error?: string
}

export function getUpdateStatus(): Promise<UpdateStatus> {
  return apiRequest<UpdateStatus>("/update/status")
}

export function applyUpdate(): Promise<{ status: string; version?: string }> {
  return apiRequest<{ status: string; version?: string }>("/update/apply", {
    method: "POST",
  })
}
