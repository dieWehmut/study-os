import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createBackup,
  getSystemStatus,
  listBackups,
  normalizeSystemStatus,
  updateSettings,
} from "./system"

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock("./client", () => mocks)

describe("system API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("normalizes diagnostics without carrying an API key through the client", () => {
    const status = normalizeSystemStatus({
      provider: {
        name: "openai",
        mode: "remote",
        configured: true,
        key_configured: true,
        api_key: "secret-value",
      },
      data: { directory: "data", database_path: "data/study.db" },
      review: { daily_limit: 25 },
      backup: { directory: "data/backups", count: 2 },
      app: { version: "0.1.0", platform: "windows" },
    })

    expect(status.provider).toEqual({
      name: "openai",
      mode: "remote",
      configured: true,
      available: false,
      key_configured: true,
    })
    expect(JSON.stringify(status)).not.toContain("secret-value")
  })

  it("uses the documented endpoints and payloads", async () => {
    mocks.apiRequest
      .mockResolvedValueOnce({ provider: {}, data: {}, review: {}, backup: {}, app: {} })
      .mockResolvedValueOnce({ items: [], count: 0 })
      .mockResolvedValueOnce({ daily_limit: 30 })
      .mockResolvedValueOnce({ category: "daily", result: {} })

    await getSystemStatus()
    await listBackups(10)
    await updateSettings({ daily_limit: 30 })
    await createBackup("daily")

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, "/system/status")
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, "/backups?limit=10")
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(3, "/settings", {
      method: "PATCH",
      body: JSON.stringify({ daily_limit: 30 }),
    })
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(4, "/backups", {
      method: "POST",
      body: JSON.stringify({ category: "daily" }),
    })
  })

  it("does not send a key-like field when updating settings", async () => {
    mocks.apiRequest.mockResolvedValueOnce({ daily_limit: 20 })
    await updateSettings({ daily_limit: 20 })
    const body = mocks.apiRequest.mock.calls[0][1].body as string
    expect(body).toBe(JSON.stringify({ daily_limit: 20 }))
    expect(body).not.toMatch(/key|secret/i)
  })

  it("turns a malformed backup payload into an empty list", async () => {
    mocks.apiRequest.mockResolvedValueOnce(null)
    await expect(listBackups()).resolves.toEqual({ items: [], count: 0 })
  })
})
