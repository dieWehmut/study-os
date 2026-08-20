import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createErrorCause,
  listErrorCauses,
  updateErrorCause,
} from "./error-causes"

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

describe("error causes API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists confirmed global and subject causes with encoded query values", async () => {
    mocks.apiRequest.mockResolvedValue({ items: [], count: 0 })

    await listErrorCauses({ subject: "physical mechanics", status: "confirmed", limit: 25, offset: 5 })

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/error-causes?subject=physical+mechanics&status=confirmed&limit=25&offset=5",
    )
  })

  it("creates a candidate without letting the client publish it directly", async () => {
    mocks.apiRequest.mockResolvedValue({
      id: "physics:model-selection",
      subject: "physics",
      label: "模型选择错误",
      review_fixes: true,
      status: "candidate",
      sort_order: 20,
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:00:00Z",
    })

    const created = await createErrorCause({
      id: "physics:model-selection",
      subject: "physics",
      parentId: "method",
      label: "模型选择错误",
      reviewFixes: true,
      action: "重画受力图",
      sourceType: "learning_session",
      sourceId: "session-1",
      sortOrder: 20,
    })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/error-causes", {
      method: "POST",
      body: JSON.stringify({
        id: "physics:model-selection",
        subject: "physics",
        parent_id: "method",
        label: "模型选择错误",
        review_fixes: true,
        action: "重画受力图",
        source_type: "learning_session",
        source_id: "session-1",
        sort_order: 20,
      }),
    })
    expect(created.status).toBe("candidate")
  })

  it("updates a URL-encoded cause id with only supplied fields", async () => {
    mocks.apiRequest.mockResolvedValue({
      id: "physics:model-selection",
      subject: "physics",
      label: "模型选择错误",
      review_fixes: true,
      status: "confirmed",
      sort_order: 20,
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:01:00Z",
    })

    await updateErrorCause("physics:model-selection", {
      status: "confirmed",
      action: "画受力图并做一道变式题",
    })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/error-causes/physics%3Amodel-selection", {
      method: "PATCH",
      body: JSON.stringify({ status: "confirmed", action: "画受力图并做一道变式题" }),
    })
  })
})
