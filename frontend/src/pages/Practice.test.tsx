import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Practice from "./Practice"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  listMistakes: vi.fn(),
  recordMistake: vi.fn(),
  deleteMistake: vi.fn(),
}))

vi.mock("@/api/mistakes", () => mocks)

let filed = 0

function log(question: string, cause: string) {
  filed += 1
  mocks.recordMistake.mockResolvedValueOnce({
    id: `qa-${filed}`,
    subject: "all",
    question,
    cause: causeOf(cause),
    createdAt: `2026-08-09T00:00:0${filed}Z`,
  })
  fireEvent.change(screen.getByLabelText("错题"), { target: { value: question } })
  fireEvent.click(screen.getByRole("button", { name: cause }))
}

function causeOf(label: string): string {
  switch (label) {
    case "想不起来":
      return "recall"
    case "看错题":
      return "misread"
    case "算错 / 手滑":
      return "careless"
    default:
      return "unknown"
  }
}

describe("Practice page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    filed = 0
    useSubjectStore.setState({ subject: "all" })
    mocks.listMistakes.mockResolvedValue([])
    mocks.deleteMistake.mockResolvedValue(undefined)
  })

  it("says plainly that nothing has gone wrong yet", async () => {
    render(<Practice />)

    expect(await screen.findByText(/还没有记录/)).toBeInTheDocument()
  })

  it("files a mistake under the cause you picked", async () => {
    render(<Practice />)
    log("光合作用第 3 问", "看错题")

    expect(await screen.findByText("光合作用第 3 问")).toBeInTheDocument()
    expect(mocks.recordMistake).toHaveBeenCalledWith({
      subject: "all",
      question: "光合作用第 3 问",
      cause: "misread",
    })
  })

  it("takes the cause click as the whole record, not a step before saving", async () => {
    // Type, pick, done. A separate 保存 button is a third action at the moment
    // you least want one -- right after getting something wrong.
    render(<Practice />)
    log("速度与加速度", "想不起来")

    await waitFor(() => expect(screen.getByLabelText("错题")).toHaveValue(""))
  })

  it("has nothing to file while the box is empty", async () => {
    render(<Practice />)

    expect(await screen.findByRole("button", { name: "想不起来" })).toBeDisabled()
  })

  it("says how much of the log review can actually fix", async () => {
    // The rest of the app answers every wrong answer with "see it again
    // sooner". This is the number that says when that answer is wrong.
    render(<Practice />)
    log("第 1 题", "想不起来")
    await screen.findByText("第 1 题")
    log("第 2 题", "看错题")
    await screen.findByText("第 2 题")
    log("第 3 题", "算错 / 手滑")
    await screen.findByText("第 3 题")

    expect(screen.getByText("复习能解决 1")).toBeInTheDocument()
    expect(screen.getByText("另有原因 2")).toBeInTheDocument()
  })

  it("says what to do about a cause review will not fix", async () => {
    render(<Practice />)
    log("第 1 题", "看错题")

    expect(await screen.findByText(/圈出条件/)).toBeInTheDocument()
  })

  it("lets you take back a row you filed wrong", async () => {
    render(<Practice />)
    log("第 1 题", "看错题")
    await screen.findByText("第 1 题")

    fireEvent.click(screen.getByRole("button", { name: /删除/ }))

    await waitFor(() => expect(screen.queryByText("第 1 题")).not.toBeInTheDocument())
    expect(mocks.deleteMistake).toHaveBeenCalledWith("qa-1")
    expect(screen.getByText(/还没有记录/)).toBeInTheDocument()
  })

  it("puts the newest mistake on top, where you are looking", async () => {
    render(<Practice />)
    log("旧的", "看错题")
    await screen.findByText("旧的")
    log("新的", "看错题")
    await screen.findByText("新的")

    const rows = screen.getAllByRole("listitem")
    expect(rows[0].textContent).toContain("新的")
  })

  it("shows a log the database was already holding", async () => {
    // Naming a cause costs you a moment at the worst possible time. A log that
    // lived only in this browser was one nothing else in the system could see.
    mocks.listMistakes.mockResolvedValue([
      {
        id: "qa-old",
        subject: "biology",
        question: "上次记的题",
        cause: "recall",
        createdAt: "2026-08-07T00:00:00Z",
      },
    ])

    render(<Practice />)

    expect(await screen.findByText("上次记的题")).toBeInTheDocument()
    expect(screen.getByText("复习能解决 1")).toBeInTheDocument()
  })

  it("asks only for the subject in hand", async () => {
    useSubjectStore.setState({ subject: "physics" })

    render(<Practice />)

    await waitFor(() => expect(mocks.listMistakes).toHaveBeenCalledWith({ subject: "physics" }))
  })

  it("does not pretend a row was filed when the write failed", async () => {
    // A row that looks saved when nothing was written is worse than one that
    // failed loudly: you stop double-checking, and the log quietly diverges.
    mocks.recordMistake.mockRejectedValueOnce(new Error("网络断了"))
    render(<Practice />)
    await screen.findByText(/还没有记录/)

    fireEvent.change(screen.getByLabelText("错题"), { target: { value: "写不进去的题" } })
    fireEvent.click(screen.getByRole("button", { name: "看错题" }))

    expect(await screen.findByText(/网络断了/)).toBeInTheDocument()
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
    expect(screen.getByLabelText("错题")).toHaveValue("写不进去的题")
  })
})
