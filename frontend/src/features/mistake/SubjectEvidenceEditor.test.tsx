import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { MistakeRecord } from "@/lib/mistakes"

import { SubjectEvidenceEditor } from "./SubjectEvidenceEditor"

const mocks = vi.hoisted(() => ({
  updateMistakeEvidence: vi.fn(),
}))

vi.mock("@/api/mistakes", () => ({
  updateMistakeEvidence: mocks.updateMistakeEvidence,
}))

function record(overrides: Partial<MistakeRecord> = {}): MistakeRecord {
  return {
    id: "attempt-1",
    questionId: "question-1",
    subject: "math",
    question: "解方程 2x + 4 = 10",
    cause: "method",
    createdAt: "2026-08-22T08:00:00Z",
    ...overrides,
  }
}

describe("editing subject-specific mistake evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("restores and saves a math derivation for the concrete attempt", async () => {
    const evidence = {
      version: 1 as const,
      subject: "math" as const,
      tool: "derivation" as const,
      data: { lines: ["2x+4=10", "2x=6"] },
    }
    const original = record({ evidence })
    const saved = {
      ...original,
      evidence: {
        ...evidence,
        data: { lines: ["2x+4=10", "2x=6", "x=3"] },
      },
    }
    const onSaved = vi.fn()
    mocks.updateMistakeEvidence.mockResolvedValue(saved)

    render(<SubjectEvidenceEditor record={original} onSaved={onSaved} />)

    expect(screen.getByRole("heading", { name: "定位推导断点" })).toBeInTheDocument()
    const derivation = screen.getByLabelText("把过程一行一行写下来")
    expect(derivation).toHaveValue("2x+4=10\n2x=6")

    fireEvent.change(derivation, { target: { value: "2x+4=10\n2x=6\nx=3" } })
    fireEvent.click(screen.getByRole("button", { name: "保存诊断证据" }))

    await waitFor(() => {
      expect(mocks.updateMistakeEvidence).toHaveBeenCalledWith("attempt-1", saved.evidence)
    })
    expect(onSaved).toHaveBeenCalledWith(saved)
    expect(screen.getByRole("status")).toHaveTextContent("已保存")
  })

  it("maps a physics method mistake to its restored free-body diagram", () => {
    render(
      <SubjectEvidenceEditor
        record={record({
          subject: "physics",
          question: "斜面上的物体怎样受力？",
          cause: "method",
          evidence: {
            version: 1,
            subject: "physics",
            tool: "free_body",
            data: {
              forces: [
                { id: "gravity", name: "重力", magnitude: 10, angle: 270, kind: "field" },
              ],
            },
          },
        })}
      />,
    )

    expect(screen.getByRole("heading", { name: "重画受力图" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "受力图，共 1 个力" })).toBeInTheDocument()
    expect(screen.getByText("重力")).toBeInTheDocument()
  })

  it("maps a physics misread mistake to its restored motion stages", () => {
    render(
      <SubjectEvidenceEditor
        record={record({
          subject: "physics",
          question: "判断汽车在哪一段减速",
          cause: "misread",
          evidence: {
            version: 1,
            subject: "physics",
            tool: "motion",
            data: {
              stages: [
                {
                  id: "accelerate",
                  name: "加速",
                  v0: 0,
                  v: 10,
                  a: 2,
                  t: 5,
                  x: 25,
                  derived: ["v", "x"],
                },
              ],
            },
          },
        })}
      />,
    )

    expect(screen.getByRole("heading", { name: "拆分运动阶段" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 4, name: "加速" })).toBeInTheDocument()
    expect(screen.getByText("末速度 10 m/s")).toBeInTheDocument()
  })

  it("explains when this subject and cause have no dedicated tool", () => {
    render(<SubjectEvidenceEditor record={record({ cause: "careless" })} />)

    expect(screen.getByText("这个错因暂时没有适用的学科诊断工具。")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "保存诊断证据" })).not.toBeInTheDocument()
  })

  it("keeps incomplete evidence local and exposes an accessible validation error", async () => {
    render(<SubjectEvidenceEditor record={record()} />)

    expect(screen.getByLabelText("把过程一行一行写下来")).toHaveValue("")
    fireEvent.click(screen.getByRole("button", { name: "保存诊断证据" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("请先完整填写诊断内容")
    expect(mocks.updateMistakeEvidence).not.toHaveBeenCalled()
  })
})
