import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createVoiceRole,
  deleteVoiceRole,
  getSpeechSettings,
  saveSpeechConfig,
  setActiveVoiceRole,
  updateVoiceRole,
  uploadVoiceRoleAvatar,
  voiceRoleAvatarURL,
} from "./speech"

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  resolveApiBase: vi.fn(),
}))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest, resolveApiBase: mocks.resolveApiBase }))

describe("speech API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveApiBase.mockReturnValue("http://127.0.0.1:8765/api")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("reads the endpoint status and roles in one request", async () => {
    mocks.apiRequest.mockResolvedValue({
      speech: { provider: "openai", key_configured: true, configured: true, providers: [] },
      roles: [],
      active_role_id: "",
    })
    const result = await getSpeechSettings()
    expect(mocks.apiRequest).toHaveBeenCalledWith("/speech")
    expect(result.speech.key_configured).toBe(true)
  })

  it("patches only the supplied fields and never gets the key back", async () => {
    mocks.apiRequest.mockResolvedValue({
      speech: { provider: "openai", voice: "nova", key_configured: true, configured: true, providers: [] },
    })
    const result = await saveSpeechConfig({ api_key: "sk-speech-secret", voice: "nova" })
    expect(mocks.apiRequest).toHaveBeenCalledWith("/speech/config", {
      method: "PATCH",
      body: JSON.stringify({ api_key: "sk-speech-secret", voice: "nova" }),
    })
    expect(JSON.stringify(result)).not.toContain("sk-speech-secret")
  })

  it("reports when a static preview has no browser speech fallback", async () => {
    vi.stubEnv("VITE_STATIC_DEMO", "true")
    const originalSpeechSynthesis = window.speechSynthesis
    const originalUtterance = globalThis.SpeechSynthesisUtterance
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined })
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: undefined })

    try {
      await expect(import("./speech").then(({ synthesizeVoiceRolePreview }) =>
        synthesizeVoiceRolePreview("voice-1", "A preview sentence"),
      )).rejects.toThrow("Browser speech is unavailable")
    } finally {
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: originalSpeechSynthesis })
      Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: originalUtterance })
    }
  })

  it("creates, updates and deletes a role on the roles collection", async () => {
    mocks.apiRequest.mockResolvedValue({ id: "voice-1", name: "晓晴", has_avatar: false, sort_order: 0 })
    await createVoiceRole({ name: "晓晴", bio: "", provider: "", base_url: "", model: "", voice: "alloy", sort_order: 0 })
    expect(mocks.apiRequest).toHaveBeenCalledWith("/speech/roles", {
      method: "POST",
      body: JSON.stringify({ name: "晓晴", bio: "", provider: "", base_url: "", model: "", voice: "alloy", sort_order: 0 }),
    })

    await updateVoiceRole("voice-1", { bio: "温柔的中文讲解声音" })
    expect(mocks.apiRequest).toHaveBeenCalledWith("/speech/roles/voice-1", {
      method: "PATCH",
      body: JSON.stringify({ bio: "温柔的中文讲解声音" }),
    })

    await deleteVoiceRole("voice-1")
    expect(mocks.apiRequest).toHaveBeenCalledWith("/speech/roles/voice-1", { method: "DELETE" })
  })

  it("clears the active role with an empty id", async () => {
    mocks.apiRequest.mockResolvedValue({ active_role_id: "" })
    const result = await setActiveVoiceRole("")
    expect(mocks.apiRequest).toHaveBeenCalledWith("/speech/roles/active", {
      method: "PATCH",
      body: JSON.stringify({ role_id: "" }),
    })
    expect(result.active_role_id).toBe("")
  })

  it("uploads an avatar as multipart form data", async () => {
    mocks.apiRequest.mockResolvedValue({ id: "voice-1", has_avatar: true, size_bytes: 4 })
    const file = new File(["face"], "face.png", { type: "image/png" })
    await uploadVoiceRoleAvatar("voice-1", file)

    const [path, init] = mocks.apiRequest.mock.calls[0] as [string, RequestInit]
    expect(path).toBe("/speech/roles/voice-1/avatar")
    expect(init.method).toBe("POST")
    // 必须是 FormData，apiRequest 靠它跳过 Content-Type，让浏览器补上 boundary。
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get("file")).toBe(file)
  })

  it("builds an absolute avatar URL that a cache buster can refresh", () => {
    expect(voiceRoleAvatarURL("voice-1")).toBe("http://127.0.0.1:8765/api/speech/roles/voice-1/avatar")
    expect(voiceRoleAvatarURL("voice-1", 1754000000000)).toBe(
      "http://127.0.0.1:8765/api/speech/roles/voice-1/avatar?v=1754000000000",
    )
  })
})
