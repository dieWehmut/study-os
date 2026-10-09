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

describe("回流 to the review queue", () => {
  const linked: QARecord = { ...record, context_type: "knowledge_item", context_id: "k-1" }

  it("says nothing about the queue until a saved record points at a knowledge point", () => {
    // The common case: this record is linked to a 错题, or to nothing at all.
    // Either way there is no card to make, and an empty block would read as a
    // broken feature rather than as an inapplicable action.
    render(
      <QARecordPanel sessionId="session-1" subject="physics" initialRecord={record} onSave={vi.fn()} onSchedule={vi.fn()} />,
    )

    expect(screen.queryByRole("region", { name: "回流到复习计划" })).not.toBeInTheDocument()
  })

  it("queues nothing until the button is pressed", () => {
    // A 学习记录 is your own account of what you now understand. Letting a
    // half-written note schedule next week's reviews without asking is the one
    // thing this section must not do.
    const onSchedule = vi.fn()
    render(
      <QARecordPanel
        sessionId="session-1"
        subject="physics"
        initialRecord={linked}
        queueTarget={{ knowledgeId: "k-1", label: "速度与加速度", queued: false }}
        onSave={vi.fn()}
        onSchedule={onSchedule}
      />,
    )

    expect(onSchedule).not.toHaveBeenCalled()
    expect(screen.getByRole("region", { name: "回流到复习计划" })).toHaveTextContent("速度与加速度")

    fireEvent.click(screen.getByRole("button", { name: "排进复习" }))
    expect(onSchedule).toHaveBeenCalledWith("k-1")
  })

  it("replaces the button with what the queue already holds", () => {
    render(
      <QARecordPanel
        sessionId="session-1"
        subject="physics"
        initialRecord={linked}
        queueTarget={{ knowledgeId: "k-1", label: "速度与加速度", queued: true }}
        onSave={vi.fn()}
        onSchedule={vi.fn()}
      />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("已经在复习计划里")
    expect(screen.queryByRole("button", { name: "排进复习" })).not.toBeInTheDocument()
    // The invitation has to go with the button: 排进复习 above 已排进复习 is the
    // control arguing with its own result.
    expect(screen.queryByText(/排进复习计划/)).not.toBeInTheDocument()
  })

  it("reports the cards the queue just accepted", () => {
    render(
      <QARecordPanel
        sessionId="session-1"
        subject="physics"
        initialRecord={linked}
        queueTarget={{ knowledgeId: "k-1", label: "速度与加速度", queued: true }}
        queuePromptCount={3}
        onSave={vi.fn()}
        onSchedule={vi.fn()}
      />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("已排进复习 · 3 张卡")
  })

  it("holds the button while the queue request is in flight", () => {
    render(
      <QARecordPanel
        sessionId="session-1"
        subject="physics"
        initialRecord={linked}
        queueTarget={{ knowledgeId: "k-1", label: "速度与加速度", queued: false }}
        queueScheduling
        onSave={vi.fn()}
        onSchedule={vi.fn()}
      />,
    )

    // Same accessible name: the label carries the state, the name stays put so
    // a second press cannot sneak through mid-request.
    expect(screen.getByRole("button", { name: "排进复习" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "排进复习" })).toHaveTextContent("正在排进…")
  })

  it("leaves the button pressable again after a failure", () => {
    render(
      <QARecordPanel
        sessionId="session-1"
        subject="physics"
        initialRecord={linked}
        queueTarget={{ knowledgeId: "k-1", label: "速度与加速度", queued: false }}
        queueError="排进复习失败，请重试。"
        onSave={vi.fn()}
        onSchedule={vi.fn()}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("排进复习失败")
    expect(screen.getByRole("button", { name: "排进复习" })).toBeEnabled()
  })
})

describe("looking past the first page of the library", () => {
  it("offers no search when the page has nothing to search", () => {
    render(<QARecordPanel sessionId="session-1" subject="physics" onSave={vi.fn()} />)

    expect(screen.queryByLabelText("搜索知识点")).not.toBeInTheDocument()
  })

  it("searches on demand rather than on every keystroke", () => {
    const onSearchContexts = vi.fn()
    render(
      <QARecordPanel sessionId="session-1" subject="physics" onSave={vi.fn()} onSearchContexts={onSearchContexts} />,
    )

    fireEvent.change(screen.getByLabelText("搜索知识点"), { target: { value: "动能" } })
    expect(onSearchContexts).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "搜索" }))
    expect(onSearchContexts).toHaveBeenCalledWith("动能")
  })

  it("keeps Enter in the search box away from the save button", () => {
    // The box sits inside the record form; the submit button next to it would
    // otherwise save a half-written record on every search.
    const onSearchContexts = vi.fn()
    const onSave = vi.fn()
    render(
      <QARecordPanel sessionId="session-1" subject="physics" onSave={onSave} onSearchContexts={onSearchContexts} />,
    )

    const box = screen.getByLabelText("搜索知识点")
    fireEvent.change(box, { target: { value: "动能" } })
    fireEvent.keyDown(box, { key: "Enter" })

    expect(onSearchContexts).toHaveBeenCalledWith("动能")
    expect(onSave).not.toHaveBeenCalled()
  })

  it("holds the search while it runs and reports what came back", () => {
    render(
      <QARecordPanel
        sessionId="session-1"
        subject="physics"
        onSave={vi.fn()}
        onSearchContexts={vi.fn()}
        searchingContexts
        contextSearchNote="没有匹配「动能」的知识点"
      />,
    )

    fireEvent.change(screen.getByLabelText("搜索知识点"), { target: { value: "动能" } })
    expect(screen.getByRole("button", { name: "搜索" })).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配「动能」的知识点")
  })
})
