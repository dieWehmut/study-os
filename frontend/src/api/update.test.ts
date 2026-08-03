import { beforeEach, describe, expect, it, vi } from "vitest"

import { applyUpdate, getUpdateStatus } from "./update"

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

describe("update API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reads update status", async () => {
    mocks.apiRequest.mockResolvedValue({
      current_version: "0.2.0",
      latest_version: "0.3.0",
      update_available: true,
    })
    const status = await getUpdateStatus()
    expect(mocks.apiRequest).toHaveBeenCalledWith("/update/status")
    expect(status.update_available).toBe(true)
  })

  it("applies an update", async () => {
    mocks.apiRequest.mockResolvedValue({ status: "updating", version: "0.3.0" })
    const result = await applyUpdate()
    expect(mocks.apiRequest).toHaveBeenCalledWith("/update/apply", { method: "POST" })
    expect(result.status).toBe("updating")
  })
})
