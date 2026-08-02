export const settingsStorageKey = "study-os-settings"

export const DEFAULT_DAILY_LIMIT = 20
export const MIN_DAILY_LIMIT = 1
export const MAX_DAILY_LIMIT = 500

export interface PersistedSettings {
  dailyLimit: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function normalizeDailyLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DAILY_LIMIT
  const integer = Math.trunc(value)
  return Math.min(MAX_DAILY_LIMIT, Math.max(MIN_DAILY_LIMIT, integer))
}

export function readPersistedSettings(): PersistedSettings {
  if (typeof localStorage === "undefined") return { dailyLimit: DEFAULT_DAILY_LIMIT }

  try {
    const raw = localStorage.getItem(settingsStorageKey)
    if (!raw) return { dailyLimit: DEFAULT_DAILY_LIMIT }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { dailyLimit: DEFAULT_DAILY_LIMIT }
    return { dailyLimit: normalizeDailyLimit(parsed.dailyLimit) }
  } catch {
    return { dailyLimit: DEFAULT_DAILY_LIMIT }
  }
}

export function writePersistedSettings(settings: PersistedSettings): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      dailyLimit: normalizeDailyLimit(settings.dailyLimit),
    }))
  } catch {
    // Persistence is best-effort; in-memory settings remain valid.
  }
}
