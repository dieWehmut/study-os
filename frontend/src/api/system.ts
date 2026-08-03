import { apiRequest } from "./client"

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
  }
}

export async function getSystemStatus(): Promise<SystemStatus> {
  return normalizeSystemStatus(await apiRequest<unknown>("/system/status"))
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
