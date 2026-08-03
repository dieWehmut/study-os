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
}))
vi.mock("@/api/system", () => mocks)
vi.mock("@/api/agent", () => ({
  getVendors: mocks.getVendors,
  setActiveProvider: mocks.setActiveProvider,
  testProvider: mocks.testProvider,
  saveVendorConfig: mocks.saveVendorConfig,
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
    mocks.getVendors.mockResolvedValue({
      active_provider: "deepseek",
      items: [
        { id: "mock", display_name: "本地离线（Mock）", implemented: true, active: false },
        { id: "deepseek", display_name: "DeepSeek", implemented: true, key_configured: true, base_url: "https://api.deepseek.com/v1", models: ["deepseek-v4-flash", "deepseek-v4-pro"], active: true },
        { id: "qwen", display_name: "通义千问（百炼）", implemented: false, active: false },
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
  })

  it("shows diagnostics and never renders a provider secret", async () => {
    render(<SettingsPanel />)

    expect(await screen.findByText("DeepSeek")).toBeInTheDocument()
    expect(screen.getByText("通义千问（百炼）")).toBeInTheDocument()
    expect(screen.getByText("API key 已配置（仅显示状态）")).toBeInTheDocument()
    expect(screen.getByText("D:/StudyOS/data")).toBeInTheDocument()
    expect(screen.queryByText(/secret|api_key/i)).not.toBeInTheDocument()
  })

  it("switches the active vendor and tests connectivity", async () => {
    render(<SettingsPanel />)

    const setActive = await screen.findByRole("button", { name: "设为当前" })
    fireEvent.click(setActive)
    await waitFor(() => expect(mocks.setActiveProvider).toHaveBeenCalledWith("mock"))

    fireEvent.click(screen.getAllByRole("button", { name: /测试连通性/ })[0])
    await waitFor(() => expect(mocks.testProvider).toHaveBeenCalledWith("mock"))
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

    fireEvent.click(await screen.findByRole("button", { name: "编辑配置" }))
    const keyInput = screen.getByLabelText("API Key")
    fireEvent.change(keyInput, { target: { value: "sk-live-secret" } })
    fireEvent.change(screen.getByLabelText("推理模型"), { target: { value: "deepseek-v4-pro" } })
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }))

    await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
      provider: "deepseek",
      api_key: "sk-live-secret",
      reasoning_model: "deepseek-v4-pro",
    }))
    expect(await screen.findByText("AI 配置已保存")).toBeInTheDocument()
    expect(screen.queryByDisplayValue("sk-live-secret")).not.toBeInTheDocument()
  })

  it("clears a stored API key", async () => {
    render(<SettingsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "编辑配置" }))
    fireEvent.click(screen.getByRole("button", { name: "清除密钥" }))

    await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
      provider: "deepseek",
      api_key: "",
    }))
  })
})
