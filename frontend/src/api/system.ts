import { apiRequest, apiRequestBlob } from "./client"

export interface ProviderStatus {
  name: string
  mode: string
  configured: boolean
  available: boolean
  key_configured: boolean
  model?: string
}

export interface DataStatus {
  directory: string
  database_path: string
}

export interface ReviewStatus {
  daily_limit: number
}

export interface BackupStatus {
  directory: string
  count: number
  last_created_at?: string
}

export interface AppStatus {
  version: string
  platform: string
}

export interface SystemStatus {
  provider: ProviderStatus
  data: DataStatus
  review: ReviewStatus
  backup: BackupStatus
  app: AppStatus
  restore: RestoreStatus
}

/**
 * A restore cannot happen while the app is running, so the page has to show both
 * halves of it: the request waiting for the next start, and how the last one went.
 * Without the second, a failed restore looks exactly like one nobody asked for.
 */
export interface RestoreStatus {
  pending: boolean
  pending_path?: string
  last_recorded: boolean
  last_ok: boolean
  last_detail?: string
  last_resolved_at?: string
}

export interface BackupRecord {
  id: string
  category: string
  path: string
  sha256: string
  size_bytes: number
  created_at: string
}

export interface BackupListResponse {
  items: BackupRecord[]
  count: number
}

export interface SettingsUpdateResponse {
  daily_limit: number
}

export type BackupCategory = "daily" | "pre-update"

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function boolValue(value: unknown): boolean {
  return value === true
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

/** Normalize untrusted diagnostics and intentionally discard any key-like fields. */
export function normalizeSystemStatus(value: unknown): SystemStatus {
  const input = recordValue(value)
  const provider = recordValue(input.provider)
  const data = recordValue(input.data)
  const review = recordValue(input.review)
  const backup = recordValue(input.backup)
  const app = recordValue(input.app)
  const restore = recordValue(input.restore)
  const normalizedProvider: ProviderStatus = {
    name: stringValue(provider.name, "mock"),
    mode: stringValue(provider.mode, "local"),
    configured: boolValue(provider.configured),
    available: boolValue(provider.available),
    key_configured: boolValue(provider.key_configured),
  }
  const model = stringValue(provider.model)
  if (model) normalizedProvider.model = model

  return {
    provider: normalizedProvider,
    data: {
      directory: stringValue(data.directory, "未提供"),
      database_path: stringValue(data.database_path, "未提供"),
    },
    review: { daily_limit: numberValue(review.daily_limit, 20) },
    backup: {
      directory: stringValue(backup.directory, "未提供"),
      count: numberValue(backup.count),
      ...(stringValue(backup.last_created_at) ? { last_created_at: stringValue(backup.last_created_at) } : {}),
    },
    app: {
      version: stringValue(app.version, "开发版"),
      platform: stringValue(app.platform, "web"),
    },
    restore: {
      pending: restore.pending === true,
      ...(stringValue(restore.pending_path) ? { pending_path: stringValue(restore.pending_path) } : {}),
      last_recorded: restore.last_recorded === true,
      last_ok: restore.last_ok === true,
      ...(stringValue(restore.last_detail) ? { last_detail: stringValue(restore.last_detail) } : {}),
      ...(stringValue(restore.last_resolved_at) ? { last_resolved_at: stringValue(restore.last_resolved_at) } : {}),
    },
  }
}

export async function getSystemStatus(): Promise<SystemStatus> {
  return normalizeSystemStatus(await apiRequest<unknown>("/system/status"))
}

/**
 * Open the data directory in the file manager.
 *
 * No path is sent: the server opens the one it is already configured with, so
 * this cannot be aimed at a directory the settings page does not show.
 */
export async function revealDataDirectory(): Promise<{ status: string; directory: string }> {
  const response = await apiRequest<unknown>("/system/reveal", { method: "POST" })
  const record = response && typeof response === "object" ? (response as Record<string, unknown>) : {}
  return {
    status: typeof record.status === "string" ? record.status : "",
    directory: typeof record.directory === "string" ? record.directory : "",
  }
}

export async function listBackups(limit = 10): Promise<BackupListResponse> {
  const raw = await apiRequest<unknown>(`/backups?limit=${Math.max(1, Math.trunc(limit))}`)
  const response = recordValue(raw) as Partial<BackupListResponse>
  return {
    items: Array.isArray(response.items) ? response.items : [],
    count: typeof response.count === "number" ? response.count : (Array.isArray(response.items) ? response.items.length : 0),
  }
}

export function updateSettings(input: { daily_limit: number }): Promise<SettingsUpdateResponse> {
  return apiRequest<SettingsUpdateResponse>("/settings", {
    method: "PATCH",
    body: JSON.stringify({ daily_limit: Math.trunc(input.daily_limit) }),
  })
}

export function createBackup(category: BackupCategory = "daily"): Promise<unknown> {
  return apiRequest("/backups", {
    method: "POST",
    body: JSON.stringify({ category }),
  })
}

/**
 * One backup file, as bytes.
 *
 * By record id: the server looks the path up itself, so nothing in this call can
 * name a file to read. The name comes back in Content-Disposition, which is the
 * only place that knows what the file is called on disk.
 */
export function downloadBackup(id: string): Promise<{ blob: Blob; filename: string }> {
  return apiRequestBlob(`/backups/${encodeURIComponent(id)}/download`)
}

export interface BackupVerification {
  ok: boolean
  size_bytes: number
  category: string
  created_at: string
  /** What the file holds, in the reader's vocabulary. Empty for an empty backup. */
  contents?: { table: string; label: string; count: number }[]
}

/**
 * Whether a backup file could actually be restored.
 *
 * Read-only: the server opens the file and runs SQLite's integrity check. It is
 * the question a reader has when choosing among dated files, and finding out
 * during a restore is the worst moment to learn.
 */
export function verifyBackup(id: string): Promise<BackupVerification> {
  return apiRequest<BackupVerification>(`/backups/${encodeURIComponent(id)}/verify`)
}

/**
 * Ask for a backup to be restored at the next start.
 *
 * Not a restore now: the running app holds the database open, so the request is
 * recorded and carried out before the store is next opened. The server answers
 * 202 to say exactly that.
 */
export function requestBackupRestore(id: string): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>(`/backups/${encodeURIComponent(id)}/restore`, { method: "POST" })
}

/**
 * Take a scheduled restore back.
 *
 * The reader may have picked the wrong file, and there is no undoing a restore
 * once the next start has replaced the data with it.
 */
export function cancelBackupRestore(): Promise<{ status: string }> {
  return apiRequest<{ status: string }>("/backups/restore", { method: "DELETE" })
}
