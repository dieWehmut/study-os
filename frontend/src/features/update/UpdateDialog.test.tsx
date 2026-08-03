import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { UpdateDialog } from "./UpdateDialog"

const mocks = vi.hoisted(() => ({
  getUpdateStatus: vi.fn(),
  applyUpdate: vi.fn(),
}))

vi.mock("@/api/update", () => ({
  getUpdateStatus: mocks.getUpdateStatus,
  applyUpdate: mocks.applyUpdate,
}))

describe("UpdateDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUpdateStatus.mockResolvedValue({
      current_version: "0.2.0-dev",
      latest_version: "0.3.0",
      update_available: true,
      release_notes: "更新说明",
    })
  })

  it("shows the update dialog when a new version is available", async () => {
    render(<UpdateDialog />)

    expect(await screen.findByText("发现新版本 0.3.0")).toBeInTheDocument()
    expect(screen.getByText("更新说明")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "稍后" }))
    expect(screen.queryByText("发现新版本 0.3.0")).not.toBeInTheDocument()
  })

  it("stays hidden when already on the latest version", async () => {
    mocks.getUpdateStatus.mockResolvedValue({
      current_version: "0.3.0",
      latest_version: "0.3.0",
      update_available: false,
    })
    render(<UpdateDialog />)

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText(/发现新版本/)).not.toBeInTheDocument()
  })
})
