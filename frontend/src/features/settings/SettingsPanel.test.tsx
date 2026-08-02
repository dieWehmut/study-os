import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import SettingsPanel from "./SettingsPanel"

const mocks = vi.hoisted(() => ({
  getSystemStatus: vi.fn(),
  listBackups: vi.fn(),
  updateSettings: vi.fn(),
  createBackup: vi.fn(),
}))
vi.mock("@/api/system", () => mocks)

const status = {
  provider: { name: "openai", mode: "remote", configured: true, key_configured: true, model: "gpt" },
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
  })

  it("shows diagnostics and never renders a provider secret", async () => {
    render(<SettingsPanel />)

    expect(await screen.findByText("OpenAI")).toBeInTheDocument()
    expect(screen.getByText("API key 已配置（仅显示状态）")).toBeInTheDocument()
    expect(screen.getByText("D:/StudyOS/data")).toBeInTheDocument()
    expect(screen.queryByText(/secret|api_key/i)).not.toBeInTheDocument()
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
})
