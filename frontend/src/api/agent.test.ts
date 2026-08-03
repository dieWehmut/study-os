import { beforeEach, describe, expect, it, vi } from "vitest"

import { getVendors, saveVendorConfig, setActiveProvider, testProvider } from "./agent"

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

describe("agent vendor API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists vendors without touching any secret field", async () => {
    mocks.apiRequest.mockResolvedValue({
      active_provider: "deepseek",
      items: [
        { id: "mock", display_name: "本地离线", implemented: true, active: false },
        { id: "deepseek", display_name: "DeepSeek", implemented: true, key_configured: true, active: true },
        { id: "qwen", display_name: "通义千问（百炼）", implemented: false, active: false },
      ],
    })
    const result = await getVendors()
    expect(mocks.apiRequest).toHaveBeenCalledWith("/agent/vendors")
    expect(result.active_provider).toBe("deepseek")
    expect(result.items).toHaveLength(3)
  })

  it("switches the active provider", async () => {
    mocks.apiRequest.mockResolvedValue({ active_provider: "deepseek" })
    const result = await setActiveProvider("deepseek")
    expect(mocks.apiRequest).toHaveBeenCalledWith("/agent/active", {
      method: "PATCH",
      body: JSON.stringify({ provider: "deepseek" }),
    })
    expect(result.active_provider).toBe("deepseek")
  })

  it("tests connectivity for a vendor", async () => {
    mocks.apiRequest.mockResolvedValue({ ok: true, provider: "mock", latency_ms: 0 })
    const result = await testProvider("mock")
    expect(mocks.apiRequest).toHaveBeenCalledWith("/agent/test", {
      method: "POST",
      body: JSON.stringify({ provider: "mock" }),
    })
    expect(result.ok).toBe(true)
  })

  it("saves vendor config without ever returning the key value", async () => {
    mocks.apiRequest.mockResolvedValue({
      provider: "deepseek",
      key_configured: true,
      base_url: "https://api.deepseek.com/v1",
      model: "deepseek-v4-flash",
      reasoning_model: "deepseek-v4-pro",
    })
    const result = await saveVendorConfig({
      provider: "deepseek",
      api_key: "sk-live-secret",
      model: "deepseek-v4-flash",
    })
    expect(mocks.apiRequest).toHaveBeenCalledWith("/agent/config", {
      method: "PATCH",
      body: JSON.stringify({
        provider: "deepseek",
        api_key: "sk-live-secret",
        model: "deepseek-v4-flash",
      }),
    })
    expect(result.key_configured).toBe(true)
    expect(JSON.stringify(result)).not.toContain("sk-live-secret")
  })
})
