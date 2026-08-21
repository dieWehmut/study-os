import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { QARecord } from "@/api/chat"
import { qaContextValue } from "./qa-record"

import QARecordPanel from "./QARecordPanel"

const record: QARecord = {
  id: "qa-1",
  session_id: "session-1",
  subject: "physics",
  original_understanding: "我把速度和加速度混为一谈。",
  corrected_model: "速度描述位移变化快慢，加速度描述速度变化快慢。",
  mastery_evidence: "能用自己的话区分两个定义。",
  unresolved: "还不确定图像题怎么判断。",
  status: "follow_up",
  created_at: "2026-08-21T00:00:00Z",
  updated_at: "2026-08-21T00:00:00Z",
}

describe("QARecordPanel", () => {
  it("shows a concise disabled state until a conversation is selected", () => {
    render(<QARecordPanel sessionId={null} subject="physics" onSave={vi.fn()} />)

    expect(screen.getByRole("status")).toHaveTextContent("先选择一段对话")
    expect(screen.getByRole("button", { name: "保存记录" })).toBeDisabled()
    expect(screen.queryByRole("textbox", { name: "原本理解" })).not.toBeInTheDocument()
  })

  it("renders each learning field in one column and restores the saved record", () => {
    const { container } = render(
      <QARecordPanel sessionId="session-1" subject="physics" initialRecord={record} onSave={vi.fn()} />,
    )

    expect(screen.getByText("physics")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "原本理解" })).toHaveValue(record.original_understanding)
    expect(screen.getByRole("textbox", { name: "纠正后的模型" })).toHaveValue(record.corrected_model)
    expect(screen.getByRole("textbox", { name: "掌握证据" })).toHaveValue(record.mastery_evidence)
    expect(screen.getByRole("textbox", { name: "未解决部分" })).toHaveValue(record.unresolved)
    expect(screen.getByRole("combobox", { name: "状态" })).toHaveValue("follow_up")
    expect(container.querySelectorAll('[class*="grid-cols-2"]')).toHaveLength(0)
  })

  it("submits edited fields through onSave", () => {
    const onSave = vi.fn()
    render(<QARecordPanel sessionId="session-1" subject="physics" onSave={onSave} />)

    fireEvent.change(screen.getByRole("textbox", { name: "原本理解" }), { target: { value: "新的理解" } })
    fireEvent.change(screen.getByRole("textbox", { name: "纠正后的模型" }), { target: { value: "新的模型" } })
    fireEvent.change(screen.getByRole("textbox", { name: "掌握证据" }), { target: { value: "新的证据" } })
    fireEvent.change(screen.getByRole("textbox", { name: "未解决部分" }), { target: { value: "新的疑问" } })
    fireEvent.change(screen.getByRole("combobox", { name: "状态" }), { target: { value: "understood" } })
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }))

    expect(onSave).toHaveBeenCalledWith({
      subject: "physics",
      original_understanding: "新的理解",
      corrected_model: "新的模型",
      mastery_evidence: "新的证据",
      unresolved: "新的疑问",
      status: "understood",
    })
  })

  it("submits a selected human-readable context as a typed id", () => {
    const onSave = vi.fn()
    render(
      <QARecordPanel
        sessionId="session-1"
        subject="physics"
        contextOptions={[{ value: qaContextValue("question", "question-1"), label: "错题：受力分析" }]}
        onSave={onSave}
      />,
    )

    fireEvent.change(screen.getByRole("combobox", { name: "关联对象" }), {
      target: { value: qaContextValue("question", "question-1") },
    })
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      context_type: "question",
      context_id: "question-1",
    }))
  })

  it("drops a malformed context value instead of submitting an invalid type", () => {
    const onSave = vi.fn()
    render(
      <QARecordPanel
        sessionId="session-1"
        subject="physics"
        contextOptions={[{ value: JSON.stringify(["invalid", "question-1"]), label: "无效关联" }]}
        onSave={onSave}
      />,
    )

    fireEvent.change(screen.getByRole("combobox", { name: "关联对象" }), {
      target: { value: JSON.stringify(["invalid", "question-1"]) },
    })
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }))

    expect(onSave).toHaveBeenCalledWith(expect.not.objectContaining({ context_type: expect.anything() }))
    expect(onSave).toHaveBeenCalledWith(expect.not.objectContaining({ context_id: expect.anything() }))
  })

  it("exposes loading, saving, and error states without allowing submission", () => {
    render(
      <QARecordPanel
        sessionId="session-1"
        subject="physics"
        loading
        saving
        error="记录保存失败"
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("正在读取记录")
    expect(screen.getByRole("alert")).toHaveTextContent("记录保存失败")
    expect(screen.getByRole("button", { name: "保存记录" })).toBeDisabled()
    expect(screen.getByRole("textbox", { name: "原本理解" })).toBeDisabled()
  })
})
