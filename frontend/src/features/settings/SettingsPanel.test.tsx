import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import SettingsPanel from "./SettingsPanel"

const mocks = vi.hoisted(() => ({
  getSystemStatus: vi.fn(),
  listBackups: vi.fn(),
  updateSettings: vi.fn(),
  createBackup: vi.fn(),
  getVendors: vi.fn(),
  setActiveProvider: vi.fn(),
  testProvider: vi.fn(),
  saveVendorConfig: vi.fn(),
  getUpdateStatus: vi.fn(),
  applyUpdate: vi.fn(),
  getSpeechSettings: vi.fn(),
  saveSpeechConfig: vi.fn(),
  listVoiceRoles: vi.fn(),
  createVoiceRole: vi.fn(),
  updateVoiceRole: vi.fn(),
  deleteVoiceRole: vi.fn(),
  setActiveVoiceRole: vi.fn(),
  uploadVoiceRoleAvatar: vi.fn(),
  synthesizeVoiceRolePreview: vi.fn(),
}))
vi.mock("@/api/system", () => mocks)
vi.mock("@/api/agent", () => ({
  getVendors: mocks.getVendors,
  setActiveProvider: mocks.setActiveProvider,
  testProvider: mocks.testProvider,
  saveVendorConfig: mocks.saveVendorConfig,
}))
vi.mock("@/api/update", () => ({
  getUpdateStatus: mocks.getUpdateStatus,
  applyUpdate: mocks.applyUpdate,
}))
vi.mock("@/api/speech", () => ({
  getSpeechSettings: mocks.getSpeechSettings,
  saveSpeechConfig: mocks.saveSpeechConfig,
  listVoiceRoles: mocks.listVoiceRoles,
  createVoiceRole: mocks.createVoiceRole,
  updateVoiceRole: mocks.updateVoiceRole,
  deleteVoiceRole: mocks.deleteVoiceRole,
  setActiveVoiceRole: mocks.setActiveVoiceRole,
  uploadVoiceRoleAvatar: mocks.uploadVoiceRoleAvatar,
  synthesizeVoiceRolePreview: mocks.synthesizeVoiceRolePreview,
  voiceRoleAvatarURL: (id: string, version?: string | number) =>
    version === undefined ? `/api/speech/roles/${id}/avatar` : `/api/speech/roles/${id}/avatar?v=${version}`,
}))

const status = {
  provider: { name: "deepseek", mode: "remote", configured: true, key_configured: true, model: "deepseek-v4-flash" },
  data: { directory: "D:/StudyOS/data", database_path: "D:/StudyOS/data/study.db" },
  review: { daily_limit: 20 },
  backup: { directory: "D:/StudyOS/data/backups", count: 1, last_created_at: "2026-08-02T00:00:00Z" },
  app: { version: "0.1.0", platform: "windows" },
}

// Mirrors backend/config/speech.go: any OpenAI-style audio endpoint is allowed,
// and the key itself is replaced by a boolean before it leaves the backend.
const speech = {
  provider: "openai",
  base_url: "https://api.openai.com/v1",
  model: "gpt-4o-mini-tts",
  voice: "alloy",
  format: "wav",
  key_configured: true,
  configured: true,
  providers: [
    { id: "openai", display_name: "OpenAI 语音", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini-tts", voice: "alloy", voice_hint: "alloy、echo、nova" },
    { id: "local", display_name: "本地服务", base_url: "http://127.0.0.1:8100/v1", local: true, endpoint_hint: "任何本地 OpenAI 兼容服务" },
  ],
}

const voiceRoles = [
  { id: "voice-1", name: "晓晴", bio: "温柔的中文讲解声音", has_avatar: true, voice: "alloy", model: "gpt-4o-mini-tts", sort_order: 0, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" },
  { id: "voice-2", name: "Nova", bio: "英文例句朗读", has_avatar: false, voice: "nova", sort_order: 1, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" },
]

describe("SettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.getSystemStatus.mockResolvedValue(status)
    mocks.listBackups.mockResolvedValue({
      count: 1,
      items: [{ id: "daily-1", category: "daily", path: "D:/StudyOS/data/backups/daily.db", sha256: "abc", size_bytes: 10, created_at: status.backup.last_created_at }],
    })
    mocks.updateSettings.mockResolvedValue({ daily_limit: 30 })
    mocks.createBackup.mockResolvedValue({ category: "daily", result: { path: "new.db" } })
    // Mirrors backend/config/vendors.go: every registered vendor is selectable and
    // reports its own [chat, reasoning] pair, so the panel must never hardcode one.
    mocks.getVendors.mockResolvedValue({
      active_provider: "deepseek",
      items: [
        { id: "mock", display_name: "本地离线", implemented: true, active: false },
        { id: "deepseek", display_name: "DeepSeek", implemented: true, key_configured: true, base_url: "https://api.deepseek.com/v1", models: ["deepseek-v4-flash", "deepseek-v4-pro"], active: true },
        { id: "claude", display_name: "Claude（Anthropic）", implemented: true, key_configured: false, base_url: "https://api.anthropic.com/v1", models: ["claude-sonnet-4-6", "claude-opus-4-6"], active: false },
        { id: "openai", display_name: "OpenAI", implemented: true, key_configured: false, base_url: "https://api.openai.com/v1", models: ["gpt-4.1-mini", "gpt-4.1"], active: false },
        { id: "qwen", display_name: "通义千问（百炼）", implemented: true, key_configured: false, base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-plus", "qwen-max"], active: false },
        { id: "glm", display_name: "智谱 GLM", implemented: true, key_configured: false, base_url: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4-flash", "glm-4-plus"], active: false },
        { id: "volcengine", display_name: "火山豆包", implemented: true, key_configured: false, base_url: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-pro-32k", "doubao-pro-256k"], active: false },
      ],
    })
    mocks.setActiveProvider.mockResolvedValue({ active_provider: "deepseek" })
    mocks.testProvider.mockResolvedValue({ ok: true, provider: "mock", latency_ms: 1 })
    mocks.saveVendorConfig.mockResolvedValue({
      provider: "deepseek",
      key_configured: true,
      base_url: "https://api.deepseek.com/v1",
      model: "deepseek-v4-flash",
      reasoning_model: "deepseek-v4-pro",
    })
    mocks.getUpdateStatus.mockResolvedValue({
      current_version: "0.2.0-dev",
      latest_version: "0.3.0",
      update_available: true,
      release_notes: "新增课程生成",
    })
    mocks.applyUpdate.mockResolvedValue({ status: "updating", version: "0.3.0" })
    mocks.getSpeechSettings.mockResolvedValue({ speech, roles: voiceRoles, active_role_id: "voice-1" })
    mocks.saveSpeechConfig.mockResolvedValue({ speech: { ...speech, voice: "nova" } })
    mocks.listVoiceRoles.mockResolvedValue({ items: voiceRoles, count: voiceRoles.length, active_role_id: "voice-1" })
    mocks.createVoiceRole.mockResolvedValue({ ...voiceRoles[1], id: "voice-3", name: "Fable" })
    mocks.updateVoiceRole.mockResolvedValue(voiceRoles[0])
    mocks.deleteVoiceRole.mockResolvedValue(undefined)
    mocks.setActiveVoiceRole.mockResolvedValue({ active_role_id: "voice-2" })
    mocks.uploadVoiceRoleAvatar.mockResolvedValue({ id: "voice-1", has_avatar: true, size_bytes: 1024 })
  })

  it("keeps every settings configuration in a single column", async () => {
    const { container } = render(<SettingsPanel />)

    expect(await screen.findByText("AI 服务商")).toBeInTheDocument()
    expect(container.querySelectorAll('[class*="grid-cols-2"]')).toHaveLength(0)
  })

  it("shows every registered vendor and never renders a provider secret", async () => {
    render(<SettingsPanel />)

    expect(await screen.findByText("DeepSeek")).toBeInTheDocument()
    for (const name of ["Claude（Anthropic）", "OpenAI", "通义千问（百炼）", "智谱 GLM", "火山豆包"]) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    // Every vendor is backed by a real wire protocol now, so none may render as
    // a placeholder the user cannot select.
    expect(screen.queryByText("待接入")).not.toBeInTheDocument()
    expect(screen.getByText("API key 已配置（仅显示状态）")).toBeInTheDocument()
    expect(screen.getByText("D:/StudyOS/data")).toBeInTheDocument()
    expect(screen.queryByText(/secret|api_key/i)).not.toBeInTheDocument()
  })

  it("switches the active vendor and tests connectivity", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "将 本地离线 设为当前" }))
    await waitFor(() => expect(mocks.setActiveProvider).toHaveBeenCalledWith("mock"))

    fireEvent.click(screen.getByRole("button", { name: "测试 Claude（Anthropic） 连通性" }))
    await waitFor(() => expect(mocks.testProvider).toHaveBeenCalledWith("claude"))
  })

  it("saves a bounded daily limit and refreshes the displayed value", async () => {
    render(<SettingsPanel />)
    const input = await screen.findByLabelText("每日记忆上限")
    fireEvent.change(input, { target: { value: "30" } })
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledWith({ daily_limit: 30 }))
    expect(await screen.findByText("设置已保存")).toBeInTheDocument()
  })

  it("creates a manual daily backup and exposes recoverable error state", async () => {
    render(<SettingsPanel />)
    await screen.findByText("备份记录")
    fireEvent.click(screen.getByRole("button", { name: "立即备份" }))
    await waitFor(() => expect(mocks.createBackup).toHaveBeenCalledWith("daily"))

    mocks.createBackup.mockRejectedValueOnce(new Error("offline"))
    fireEvent.click(screen.getByRole("button", { name: "立即备份" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("备份失败")
  })

  it("shows a single diagnostic error and offers a retry", async () => {
    mocks.getSystemStatus.mockRejectedValueOnce(new Error("offline"))
    render(<SettingsPanel />)

    expect((await screen.findByRole("alert")).textContent).toContain("无法读取系统设置：offline")
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })

  it("saves an API key and model through the vendor config form without echoing the key", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "编辑 DeepSeek 配置" }))
    const keyInput = screen.getByLabelText("API Key")
    fireEvent.change(keyInput, { target: { value: "sk-live-secret" } })
    const reasoningModelInput = screen.getByLabelText("推理模型")
    expect(reasoningModelInput).toHaveAttribute("list", "deepseek-model-options")
    fireEvent.change(reasoningModelInput, { target: { value: "deepseek-v4-pro" } })
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }))

    await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
      provider: "deepseek",
      api_key: "sk-live-secret",
      reasoning_model: "deepseek-v4-pro",
    }))
    expect(await screen.findByText("AI 配置已保存")).toBeInTheDocument()
    expect(screen.queryByDisplayValue("sk-live-secret")).not.toBeInTheDocument()
  })

  it("configures Claude with its own models rather than the active vendor's", async () => {
    mocks.getVendors.mockResolvedValueOnce({
      active_provider: "deepseek",
      items: [
        { id: "deepseek", display_name: "DeepSeek", implemented: true, key_configured: true, base_url: "https://api.deepseek.com/v1", models: ["deepseek-v4-flash", "deepseek-v4-pro"], active: true },
        { id: "claude", display_name: "Claude（Anthropic）", implemented: true, key_configured: false, base_url: "https://api.anthropic.com/v1", models: ["claude-sonnet-4-6", "claude-sonnet-4-6"], active: false },
      ],
    })
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "编辑 Claude（Anthropic） 配置" }))
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-ant-secret" } })
    const modelInput = screen.getByLabelText("模型", { selector: "#claude-model" })
    expect(modelInput).toHaveAttribute("list", "claude-model-options")
    const modelValues = Array.from(document.querySelectorAll<HTMLOptionElement>("#claude-model-options option")).map((option) => option.value)
    expect(modelValues).toEqual(["claude-sonnet-4-6"])
    expect(modelValues).not.toContain("deepseek-v4-flash")
    fireEvent.change(modelInput, { target: { value: "claude-sonnet-4-6" } })
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }))

    await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
      provider: "claude",
      api_key: "sk-ant-secret",
      model: "claude-sonnet-4-6",
    }))
  })

  it("saves custom chat and reasoning model names outside the vendor suggestions", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "编辑 DeepSeek 配置" }))
    const modelInput = screen.getByLabelText("模型", { selector: "#deepseek-model" })
    const reasoningModelInput = screen.getByLabelText("推理模型")
    expect(modelInput).toHaveAttribute("list", "deepseek-model-options")
    expect(reasoningModelInput).toHaveAttribute("list", "deepseek-model-options")
    fireEvent.change(modelInput, { target: { value: "  openrouter/custom-chat:v3  " } })
    fireEvent.change(reasoningModelInput, { target: { value: "  private/reasoner:latest  " } })
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }))

    await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
      provider: "deepseek",
      model: "openrouter/custom-chat:v3",
      reasoning_model: "private/reasoner:latest",
    }))
  })

  it("omits model fields that contain only whitespace", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "编辑 DeepSeek 配置" }))
    const modelInput = screen.getByLabelText("模型", { selector: "#deepseek-model" })
    const reasoningModelInput = screen.getByLabelText("推理模型")
    expect(modelInput).toHaveAttribute("list", "deepseek-model-options")
    expect(reasoningModelInput).toHaveAttribute("list", "deepseek-model-options")
    fireEvent.change(modelInput, { target: { value: "   " } })
    fireEvent.change(reasoningModelInput, { target: { value: "  " } })
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }))

    await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({ provider: "deepseek" }))
  })

  it("keeps model inputs editable when a vendor reports no suggestions", async () => {
    mocks.getVendors.mockResolvedValueOnce({
      active_provider: "custom",
      items: [
        {
          id: "custom",
          display_name: "自定义服务",
          implemented: true,
          key_configured: true,
          base_url: "http://127.0.0.1:9000/v1",
          active: true,
        },
      ],
    })
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "编辑 自定义服务 配置" }))
    const modelInput = document.querySelector<HTMLInputElement>("#custom-model")
    const reasoningModelInput = document.querySelector<HTMLInputElement>("#custom-reasoning-model")
    const modelSuggestions = document.querySelector<HTMLDataListElement>("#custom-model-options")

    expect(modelInput).toBeInTheDocument()
    expect(modelInput).toHaveAttribute("type", "text")
    expect(modelInput).toBeEnabled()
    expect(modelInput).toHaveAttribute("list", "custom-model-options")
    expect(reasoningModelInput).toBeInTheDocument()
    expect(reasoningModelInput).toHaveAttribute("type", "text")
    expect(reasoningModelInput).toBeEnabled()
    expect(reasoningModelInput).toHaveAttribute("list", "custom-model-options")
    expect(modelSuggestions).toBeInTheDocument()
    expect(modelSuggestions?.querySelectorAll("option")).toHaveLength(0)

    fireEvent.change(modelInput!, { target: { value: "custom/chat:latest" } })
    fireEvent.change(reasoningModelInput!, { target: { value: "custom/reasoner:latest" } })
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }))

    await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
      provider: "custom",
      model: "custom/chat:latest",
      reasoning_model: "custom/reasoner:latest",
    }))
  })

  it("drops a draft belonging to the previously opened vendor", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "编辑 DeepSeek 配置" }))
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-deepseek-secret" } })
    fireEvent.click(screen.getByRole("button", { name: "编辑 Claude（Anthropic） 配置" }))
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }))

    // A single draft state backs every editor, so leaking it would send DeepSeek's
    // credential to Anthropic.
    await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({ provider: "claude" }))
  })

  it("clears a stored API key", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "编辑 DeepSeek 配置" }))
    fireEvent.click(screen.getByRole("button", { name: "清除密钥" }))

    await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
      provider: "deepseek",
      api_key: "",
    }))
  })

  it("saves only the speech fields the user actually touched", async () => {
    render(<SettingsPanel />)

    fireEvent.change(await screen.findByLabelText("默认发音人"), { target: { value: "nova" } })
    fireEvent.change(screen.getByLabelText("语音合成 API Key"), { target: { value: "sk-speech-secret" } })
    fireEvent.click(screen.getByRole("button", { name: "保存语音配置" }))

    // 省略即不改，所以没被碰过的接口地址／模型不能出现在请求体里。
    await waitFor(() => expect(mocks.saveSpeechConfig).toHaveBeenCalledWith({
      api_key: "sk-speech-secret",
      voice: "nova",
    }))
    expect(await screen.findByText("语音合成配置已保存")).toBeInTheDocument()
    expect(screen.queryByDisplayValue("sk-speech-secret")).not.toBeInTheDocument()
  })

  it("never echoes the stored speech key and only offers to overwrite it", async () => {
    render(<SettingsPanel />)

    const keyInput = await screen.findByLabelText("语音合成 API Key")
    expect(keyInput).toHaveValue("")
    expect(keyInput).toHaveAttribute("type", "password")
    expect(keyInput).toHaveAttribute("placeholder", "留空保持不变")
    expect(screen.getByText("密钥已配置（仅显示状态）")).toBeInTheDocument()
    expect(screen.queryByDisplayValue(/^sk-/)).not.toBeInTheDocument()
  })

  it("fills the preset defaults into the endpoint form", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("combobox", { name: "语音服务预设" }))
    const option = await screen.findByRole("option", { name: "本地服务" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    await waitFor(() => expect(screen.getByLabelText("语音接口地址")).toHaveValue("http://127.0.0.1:8100/v1"))
    expect(screen.getByText("本地服务通常不需要 API Key。")).toBeInTheDocument()
  })

  it("creates a voice role from the inline form", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "新增角色" }))
    fireEvent.change(screen.getByLabelText("角色名字"), { target: { value: "Fable" } })
    fireEvent.change(screen.getByLabelText("角色简介"), { target: { value: "英式旁白" } })
    fireEvent.change(screen.getByLabelText("角色发音人"), { target: { value: "fable" } })
    fireEvent.click(screen.getByRole("button", { name: "创建角色" }))

    await waitFor(() => expect(mocks.createVoiceRole).toHaveBeenCalledWith({
      name: "Fable",
      bio: "英式旁白",
      provider: "",
      base_url: "",
      model: "",
      voice: "fable",
      sort_order: 2,
    }))
    expect(await screen.findByText("语音角色已创建")).toBeInTheDocument()
  })

  it("switches the active voice role in one click", async () => {
    render(<SettingsPanel />)

    expect(await screen.findByText("温柔的中文讲解声音")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "将 Nova 设为当前角色" }))

    await waitFor(() => expect(mocks.setActiveVoiceRole).toHaveBeenCalledWith("voice-2"))
    expect(await screen.findByText("已切换当前语音角色")).toBeInTheDocument()
    // 激活状态整体搬家：原来的当前角色重新长出"设为当前"。
    expect(screen.getByRole("button", { name: "将 晓晴 设为当前角色" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "将 Nova 设为当前角色" })).not.toBeInTheDocument()
  })

  it("patches only the role fields that changed", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "编辑 晓晴" }))
    fireEvent.change(screen.getByLabelText("角色简介"), { target: { value: "更新后的简介" } })
    fireEvent.click(screen.getByRole("button", { name: "保存 晓晴" }))

    await waitFor(() => expect(mocks.updateVoiceRole).toHaveBeenCalledWith("voice-1", { bio: "更新后的简介" }))
  })

  it("uploads an avatar and busts the cached image URL", async () => {
    render(<SettingsPanel />)

    const previousSource = (await screen.findByAltText("晓晴 的头像")).getAttribute("src")
    fireEvent.click(screen.getByRole("button", { name: "编辑 晓晴" }))
    const file = new File(["face"], "face.png", { type: "image/png" })
    fireEvent.change(screen.getByLabelText("上传 晓晴 的头像"), { target: { files: [file] } })

    await waitFor(() => expect(mocks.uploadVoiceRoleAvatar).toHaveBeenCalledWith("voice-1", file))
    // 后端把新图写回同一个地址，URL 不变的话浏览器会继续画旧的那张脸。
    await waitFor(() => expect(screen.getByAltText("晓晴 的头像").getAttribute("src")).not.toBe(previousSource))
  })

  it("checks for updates and applies a new version", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "检查更新" }))
    expect(await screen.findByText("发现新版本 0.3.0")).toBeInTheDocument()
    expect(screen.getByText("新增课程生成")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "立即更新" }))
    await waitFor(() => expect(mocks.applyUpdate).toHaveBeenCalledOnce())
  })

  // 试听按钮读的是角色简介——它是这个角色的"名片"，最能听出音色像不像。
  function stubAudioPlayback() {
    URL.createObjectURL = vi.fn(() => "blob:preview")
    URL.revokeObjectURL = vi.fn()
    return vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  }

  it("试听一个角色时朗读它的简介", async () => {
    const play = stubAudioPlayback()
    mocks.synthesizeVoiceRolePreview.mockResolvedValue(new Blob(["audio"], { type: "audio/wav" }))
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "试听 晓晴" }))

    await waitFor(() =>
      expect(mocks.synthesizeVoiceRolePreview).toHaveBeenCalledWith("voice-1", "温柔的中文讲解声音"),
    )
    await waitFor(() => expect(play).toHaveBeenCalled())
    // 播完要把 blob 收回去，否则试听几次就攒下一堆再也用不到的音频。
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it("角色没写简介时改读它的名字，而不是一声不响", async () => {
    stubAudioPlayback()
    mocks.synthesizeVoiceRolePreview.mockResolvedValue(new Blob(["audio"], { type: "audio/wav" }))
    mocks.getSpeechSettings.mockResolvedValue({
      speech,
      roles: [{ ...voiceRoles[1], bio: "" }],
      active_role_id: "",
    })
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "试听 Nova" }))

    await waitFor(() => expect(mocks.synthesizeVoiceRolePreview).toHaveBeenCalledWith("voice-2", "Nova"))
  })

  it("treats the browser speech fallback as a successful preview", async () => {
    URL.createObjectURL = vi.fn(() => "blob:unexpected")
    mocks.synthesizeVoiceRolePreview.mockResolvedValue(null)
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "试听 Nova" }))

    await waitFor(() => expect(mocks.synthesizeVoiceRolePreview).toHaveBeenCalledWith("voice-2", "英文例句朗读"))
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("试听失败时说明原因，而不是静静地什么都不发生", async () => {
    stubAudioPlayback()
    mocks.synthesizeVoiceRolePreview.mockRejectedValue(new Error("语音服务没有响应"))
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "试听 晓晴" }))

    expect(await screen.findByText("语音服务没有响应")).toBeInTheDocument()
  })
})
