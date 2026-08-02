import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEFAULT_DAILY_LIMIT,
  MAX_DAILY_LIMIT,
  MIN_DAILY_LIMIT,
  normalizeDailyLimit,
  readPersistedSettings,
  settingsStorageKey,
  writePersistedSettings,
} from "./settings"
import { themeStorageKey } from "./theme"

describe("local settings persistence", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uses a bounded default when there is no saved settings document", () => {
    expect(readPersistedSettings()).toEqual({ dailyLimit: DEFAULT_DAILY_LIMIT })
  })

  it("clamps the daily limit and ignores unknown or secret fields", () => {
    localStorage.setItem(
      settingsStorageKey,
      JSON.stringify({ dailyLimit: MAX_DAILY_LIMIT + 100, apiKey: "do-not-store" }),
    )

    expect(readPersistedSettings()).toEqual({ dailyLimit: MAX_DAILY_LIMIT })
    expect(readPersistedSettings()).not.toHaveProperty("apiKey")
  })

  it("recovers from malformed local storage without throwing", () => {
    localStorage.setItem(settingsStorageKey, "not-json")

    expect(readPersistedSettings()).toEqual({ dailyLimit: DEFAULT_DAILY_LIMIT })
  })

  it("recovers when storage reads throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied")
    })

    expect(() => readPersistedSettings()).not.toThrow()
    expect(readPersistedSettings()).toEqual({ dailyLimit: DEFAULT_DAILY_LIMIT })
  })

  it("never throws when storage writes are rejected", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded")
    })

    expect(() => writePersistedSettings({ dailyLimit: DEFAULT_DAILY_LIMIT })).not.toThrow()
  })

  it("writes only the validated settings schema", () => {
    localStorage.setItem(themeStorageKey, "dark")
    writePersistedSettings({ dailyLimit: MIN_DAILY_LIMIT - 1 })

    expect(JSON.parse(localStorage.getItem(settingsStorageKey)!)).toEqual({
      dailyLimit: MIN_DAILY_LIMIT,
    })
    expect(localStorage.getItem(themeStorageKey)).toBe("dark")
  })

  it("normalizes non-finite and fractional values", () => {
    expect(normalizeDailyLimit(Number.NaN)).toBe(DEFAULT_DAILY_LIMIT)
    expect(normalizeDailyLimit(12.9)).toBe(12)
  })

  it("matches the backend limit contract up to 500 reviews per day", () => {
    expect(normalizeDailyLimit(500)).toBe(500)
    expect(normalizeDailyLimit(501)).toBe(500)
  })
})
