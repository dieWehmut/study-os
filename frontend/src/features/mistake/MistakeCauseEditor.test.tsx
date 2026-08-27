import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ErrorCause } from "@/api/error-causes"
import type { MistakeRecord } from "@/lib/mistakes"

import { MistakeCauseEditor } from "./MistakeCauseEditor"

const mocks = vi.hoisted(() => ({
  listErrorCauses: vi.fn(),
  reclassifyMistake: vi.fn(),
}))

vi.mock("@/api/error-causes", () => ({
  listErrorCauses: mocks.listErrorCauses,
}))

vi.mock("@/api/mistakes", () => ({
  reclassifyMistake: mocks.reclassifyMistake,
}))

function record(overrides: Partial<MistakeRecord> = {}): MistakeRecord {
  return {
    id: "attempt-1",
    questionId: "question-1",
    subject: "physics",
    question: "斜面上的物体怎样受力？",
    cause: "旧的自由文本原因",
    createdAt: "2026-08-24T08:00:00Z",
    ...overrides,
  }
}

function cause(id: string, label: string, subject = ""): ErrorCause {
  return {
    id,
    subject,
    label,
    reviewFixes: false,
    action: "按新错因处理",
    status: "confirmed",
    sortOrder: 0,
    createdAt: "2026-08-24T08:00:00Z",
    updatedAt: "2026-08-24T08:00:00Z",
  }
}

async function chooseCause(label: string) {
  fireEvent.click(await screen.findByRole("combobox", { name: "新错因" }))
  const option = await screen.findByRole("option", { name: label })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
}

describe("reclassifying a concrete mistake", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads confirmed causes lazily and migrates an unknown old cause", async () => {
    const original = record()
    const updated = { ...original, cause: "physics:model-selection" }
    const onSaved = vi.fn()
    mocks.listErrorCauses.mockResolvedValue([
      cause("recall", "想不起来"),
      cause("physics:model-selection", "对象 / 模型选择错误", "physics"),
    ])
    mocks.reclassifyMistake.mockResolvedValue(updated)

    render(<MistakeCauseEditor record={original} onSaved={onSaved} />)

    expect(mocks.listErrorCauses).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "重新归类" }))

    await waitFor(() => {
      expect(mocks.listErrorCauses).toHaveBeenCalledWith({
        subject: "physics",
        status: "confirmed",
      })
    })
    await chooseCause("对象 / 模型选择错误")
    fireEvent.click(screen.getByRole("button", { name: "保存归类" }))

    await waitFor(() => {
      expect(mocks.reclassifyMistake).toHaveBeenCalledWith(
        "attempt-1",
        "physics:model-selection",
      )
    })
    expect(onSaved).toHaveBeenCalledWith(
      updated,
      expect.objectContaining({ id: "physics:model-selection", label: "对象 / 模型选择错误" }),
    )
    expect(screen.getByRole("button", { name: "重新归类" })).toBeInTheDocument()
  })

  it("cancels without changing the record", async () => {
    mocks.listErrorCauses.mockResolvedValue([cause("method", "思路不对")])

    render(<MistakeCauseEditor record={record()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "重新归类" }))
    await screen.findByRole("combobox", { name: "新错因" })
    fireEvent.click(screen.getByRole("button", { name: "取消" }))

    expect(screen.queryByRole("combobox", { name: "新错因" })).not.toBeInTheDocument()
    expect(mocks.reclassifyMistake).not.toHaveBeenCalled()
  })

  it("shows an accessible load error without inventing fallback causes", async () => {
    mocks.listErrorCauses.mockRejectedValue(new Error("服务不可用"))

    render(<MistakeCauseEditor record={record()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "重新归类" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("读取错因失败：服务不可用")
    expect(screen.queryByRole("combobox", { name: "新错因" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled()
  })

  it("keeps the chosen cause available after a save error", async () => {
    mocks.listErrorCauses.mockResolvedValue([
      cause("physics:model-selection", "对象 / 模型选择错误", "physics"),
    ])
    mocks.reclassifyMistake.mockRejectedValue(new Error("写入失败"))

    render(<MistakeCauseEditor record={record()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "重新归类" }))
    await chooseCause("对象 / 模型选择错误")
    fireEvent.click(screen.getByRole("button", { name: "保存归类" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("重新归类失败：写入失败")
    expect(screen.getByRole("combobox", { name: "新错因" })).toHaveTextContent("对象 / 模型选择错误")
    expect(screen.getByRole("button", { name: "保存归类" })).toBeEnabled()
  })

  it("locks the editor while the new cause is being saved", async () => {
    const original = record()
    const updated = { ...original, cause: "physics:model-selection" }
    let finish!: (value: MistakeRecord) => void
    mocks.listErrorCauses.mockResolvedValue([
      cause("physics:model-selection", "对象 / 模型选择错误", "physics"),
    ])
    mocks.reclassifyMistake.mockReturnValue(new Promise<MistakeRecord>((resolve) => {
      finish = resolve
    }))

    render(<MistakeCauseEditor record={original} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "重新归类" }))
    await chooseCause("对象 / 模型选择错误")
    fireEvent.click(screen.getByRole("button", { name: "保存归类" }))

    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "新错因" })).toBeDisabled()

    finish(updated)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重新归类" })).toBeInTheDocument()
    })
  })
})
