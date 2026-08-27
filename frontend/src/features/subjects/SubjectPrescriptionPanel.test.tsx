import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SubjectPrescriptionPanel } from "./SubjectPrescriptionPanel"

describe("SubjectPrescriptionPanel", () => {
  it("shows one compact, selectable prescription for every subject", () => {
    const onSelect = vi.fn()
    render(<SubjectPrescriptionPanel subject="all" onSelectSubject={onSelect} />)

    expect(screen.getByRole("heading", { name: "六科学习处方" })).toBeInTheDocument()
    expect(screen.getAllByTestId("subject-prescription-card")).toHaveLength(6)
    expect(screen.getByText("文本证据、得分点与表达结构")).toBeInTheDocument()
    expect(screen.getByText("题目条件、图形关系与首个推导断点")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /数学/ }))
    expect(onSelect).toHaveBeenCalledWith("math")
  })

  it("expands the selected subject without showing unrelated prescriptions", () => {
    render(<SubjectPrescriptionPanel subject="math" />)

    expect(screen.getByRole("heading", { name: "数学学习处方" })).toBeInTheDocument()
    expect(screen.getByText("列出已知、所求和限制")).toBeInTheDocument()
    expect(screen.getByText("保留条件清单、关键图形关系和首个错误步骤。")).toBeInTheDocument()
    expect(screen.getByText("只针对断点做一题变式，再验证策略是否迁移。")).toBeInTheDocument()
    expect(screen.queryByText("文本证据、得分点与表达结构")).not.toBeInTheDocument()
  })

  it("renders a useful fallback for an unknown subject", () => {
    render(<SubjectPrescriptionPanel subject="biology" />)

    expect(screen.getByRole("heading", { name: "学习处方" })).toBeInTheDocument()
    expect(screen.getByText(/暂未配置/)).toBeInTheDocument()
  })
})
