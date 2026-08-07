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

const status = {
  provider: { name: "deepseek", mode: "remote", configured: true, key_configured: true, model: "deepseek-v4-flash" },
  data: { directory: "D:/StudyOS/data", database_path: "D:/StudyOS/data/study.db" },
  review: { daily_limit: 20 },
  backup: { directory: "D:/StudyOS/data/backups", count: 1, last_created_at: "2026-08-02T00:00:00Z" },
  app: { version: "0.1.0", platform: "windows" },
}

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
    fireEvent.click(screen.getByRole("combobox", { name: "推理模型" }))
    const option = await screen.findByRole("option", { name: "deepseek-v4-pro" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
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
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "编辑 Claude（Anthropic） 配置" }))
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-ant-secret" } })
    fireEvent.click(screen.getByRole("combobox", { name: "模型" }))
    // The option list is derived from the vendor's own model pair, so DeepSeek's
    // models must not be reachable while Claude's editor is open.
    expect(screen.queryByRole("option", { name: "deepseek-v4-flash" })).not.toBeInTheDocument()
    const option = await screen.findByRole("option", { name: "claude-opus-4-6" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }))

    await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
      provider: "claude",
      api_key: "sk-ant-secret",
      model: "claude-opus-4-6",
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

  it("checks for updates and applies a new version", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "检查更新" }))
    expect(await screen.findByText("发现新版本 0.3.0")).toBeInTheDocument()
    expect(screen.getByText("新增课程生成")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "立即更新" }))
    await waitFor(() => expect(mocks.applyUpdate).toHaveBeenCalledOnce())
  })
})
