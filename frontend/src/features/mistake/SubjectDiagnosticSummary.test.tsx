import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { SubjectDiagnosticSummary } from "@/lib/mistake-diagnostics"

import { SubjectDiagnosticSummary as SubjectDiagnosticSummaryView } from "./SubjectDiagnosticSummary"

const subjects = [
  ["chinese", "语文"],
  ["math", "数学"],
  ["english", "英语"],
  ["physics", "物理"],
  ["chemistry", "化学"],
  ["geography", "地理"],
] as const

function summary(subject: string, label: string, overrides: Partial<SubjectDiagnosticSummary> = {}): SubjectDiagnosticSummary {
  return {
    subject,
    label,
    total: 0,
    corrected: 0,
    evidenceTotal: 0,
    evidenceCompleted: 0,
    topCause: null,
    topCauseLabel: null,
    action: null,
    toolReadyCount: 0,
    ...overrides,
  }
}

describe("SubjectDiagnosticSummary", () => {
  it("keeps all six subject rows in the shared order", () => {
    const summaries = [
      summary("math", "数学", {
        total: 4,
        corrected: 1,
        evidenceTotal: 2,
        evidenceCompleted: 1,
        topCause: "method",
        topCauseLabel: "方法不熟",
        action: "定位推导断点",
        toolReadyCount: 2,
      }),
      summary("english", "英语", { total: 2 }),
    ]

    render(<SubjectDiagnosticSummaryView summaries={summaries} activeSubject="math" />)

    const rows = screen.getAllByTestId("subject-diagnostic-row")
    expect(rows).toHaveLength(6)
    expect(rows.map((row) => within(row).getByRole("heading", { level: 3 }).textContent)).toEqual(subjects.map(([, label]) => label))

    const mathRow = screen.getAllByTestId("subject-diagnostic-row").find((row) => row.getAttribute("data-subject") === "math") as HTMLElement
    expect(mathRow).not.toBeNull()
    expect(mathRow).toHaveAttribute("aria-current", "true")
    expect(within(mathRow).getByText("错题 4")).toBeInTheDocument()
    expect(within(mathRow).getByText("证据 1/2")).toBeInTheDocument()
    expect(within(mathRow).getByText("订正 1")).toBeInTheDocument()
    expect(within(mathRow).getByText("方法不熟")).toBeInTheDocument()
    expect(within(mathRow).getByText("定位推导断点")).toBeInTheDocument()
  })

  it("renders useful zero state rows when there are no summaries", () => {
    render(<SubjectDiagnosticSummaryView summaries={[]} activeSubject="all" />)

    expect(screen.getByRole("heading", { name: "六科诊断总览" })).toBeInTheDocument()
    expect(screen.getAllByTestId("subject-diagnostic-row")).toHaveLength(6)
    expect(screen.getAllByText("错题 0")).toHaveLength(6)
    expect(screen.getAllByText("暂无错因")).toHaveLength(6)
    expect(screen.getAllByText("先记录一次错因")).toHaveLength(6)
  })

  it("notifies the caller when an interactive subject row is selected", () => {
    const onSelectSubject = vi.fn()
    render(
      <SubjectDiagnosticSummaryView
        summaries={[summary("geography", "地理", { total: 3 })]}
        activeSubject="english"
        onSelectSubject={onSelectSubject}
      />,
    )

    fireEvent.click(document.querySelector("[data-subject='geography']") as HTMLElement)
    expect(onSelectSubject).toHaveBeenCalledWith("geography")
    expect(document.querySelector("[data-subject='english']")).toHaveAttribute("aria-current", "true")
    expect(document.querySelector("[data-subject='geography']")).toHaveAttribute("aria-current", "false")
  })
})
