import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import Practice from "./Practice"
import { mistakesStorageKey } from "@/lib/mistakes"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  listMistakes: vi.fn(),
  recordMistake: vi.fn(),
  deleteMistake: vi.fn(),
  scheduleMistake: vi.fn(),
  correctMistake: vi.fn(),
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
    case "思路不对":
      return "method"
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
    mocks.scheduleMistake.mockResolvedValue("k-mistake-1")
    // 订正 answers with the row still a mistake, now carrying the mark. The
    // page reads the mark and keeps the text it already has, so the stub does
    // not need to echo the question back.
    mocks.correctMistake.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        subject: "all",
        question: "题",
        cause: "method",
        corrected: true,
        createdAt: "2026-08-09T00:00:00Z",
      }),
    )
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

  it("carries a log left in the browser into the database, once", async () => {
    // Everything filed before the page had a backend is sitting in
    // localStorage, invisible to the rest of the system. Dropping it would
    // punish the people who used the feature first.
    localStorage.setItem(
      mistakesStorageKey,
      JSON.stringify([
        { id: "old-2", subject: "physics", question: "新一点的", cause: "misread", createdAt: "2026-08-07T01:00:00Z" },
        { id: "old-1", subject: "physics", question: "旧一点的", cause: "recall", createdAt: "2026-08-07T00:00:00Z" },
      ]),
    )
    mocks.recordMistake
      .mockResolvedValueOnce({ id: "qa-a", subject: "physics", question: "旧一点的", cause: "recall", createdAt: "2026-08-09T00:00:00Z" })
      .mockResolvedValueOnce({ id: "qa-b", subject: "physics", question: "新一点的", cause: "misread", createdAt: "2026-08-09T00:00:01Z" })

    render(<Practice />)

    expect(await screen.findByText("新一点的")).toBeInTheDocument()
    expect(screen.getByText("旧一点的")).toBeInTheDocument()
    // Oldest first, so the newest still lands on top once the server has them.
    expect(mocks.recordMistake.mock.calls.map((call) => call[0].question)).toEqual(["旧一点的", "新一点的"])
    // Clearing the key is what makes it once rather than every mount.
    await waitFor(() => expect(localStorage.getItem(mistakesStorageKey)).toBeNull())
  })

  it("keeps the browser log when the migration could not be written", async () => {
    // Clearing the key on a failed write would lose the rows for good. Leaving
    // it costs one retry next time the page opens.
    localStorage.setItem(
      mistakesStorageKey,
      JSON.stringify([
        { id: "old-1", subject: "physics", question: "搬不过去的题", cause: "recall", createdAt: "2026-08-07T00:00:00Z" },
      ]),
    )
    mocks.recordMistake.mockRejectedValueOnce(new Error("网络断了"))

    render(<Practice />)

    expect(await screen.findByText(/网络断了/)).toBeInTheDocument()
    expect(localStorage.getItem(mistakesStorageKey)).not.toBeNull()
  })

  it("offers to queue the one kind of mistake more review actually fixes", async () => {
    // Until now the page could only *say* 想不起来 is what review repairs. The
    // button is what makes the sentence do something.
    render(<Practice />)
    log("速度与加速度", "想不起来")
    await screen.findByText("速度与加速度")

    expect(screen.getByRole("button", { name: /^排进复习$/ })).toBeInTheDocument()
  })

  it("does not offer the queue on a mistake review will not fix", async () => {
    // Rescheduling a card you misread reshuffles something that was never the
    // problem, and the mistake comes back looking like a memory failure it
    // never was. The row already says what to do instead.
    render(<Practice />)
    log("光合作用第 3 问", "看错题")
    await screen.findByText("光合作用第 3 问")

    expect(screen.queryByRole("button", { name: /排进复习/ })).not.toBeInTheDocument()
  })

  it("marks the row queued once the card was written", async () => {
    render(<Practice />)
    log("速度与加速度", "想不起来")
    await screen.findByText("速度与加速度")

    fireEvent.click(screen.getByRole("button", { name: /^排进复习$/ }))

    expect(await screen.findByText("已排进复习")).toBeInTheDocument()
    expect(mocks.scheduleMistake).toHaveBeenCalledWith("qa-1")
    expect(screen.queryByRole("button", { name: /^排进复习$/ })).not.toBeInTheDocument()
  })

  it("leaves the row pressable when the card could not be written", async () => {
    // A control that looks saved when nothing was written is worse than one
    // that failed loudly.
    mocks.scheduleMistake.mockRejectedValueOnce(new Error("安排复习失败"))
    render(<Practice />)
    log("速度与加速度", "想不起来")
    await screen.findByText("速度与加速度")

    fireEvent.click(screen.getByRole("button", { name: /^排进复习$/ }))

    expect(await screen.findByText(/安排复习失败/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^排进复习$/ })).toBeEnabled()
  })

  it("says what to do about a cause a subject can put better than in general", async () => {
    // 思路不对 in 物理 is nearly always the wrong model picked, and the fix is
    // a drawing. The shared sentence -- 找同类题再做两道 -- sends you to do more
    // of the thing that just failed.
    useSubjectStore.setState({ subject: "physics" })
    render(<Practice />)
    log("斜面上的木块", "思路不对")

    expect(await screen.findByText(/受力图/)).toBeInTheDocument()
  })

  it("keeps to the shared advice while the log mixes every subject", async () => {
    // 全部学科 is the default, and a sentence naming 受力图 would then sit under
    // a bar counting 语文 rows too.
    render(<Practice />)
    log("斜面上的木块", "思路不对")
    await screen.findByText("斜面上的木块")

    expect(screen.getByText(/找同类题再做两道/)).toBeInTheDocument()
    expect(screen.queryByText(/受力图/)).not.toBeInTheDocument()
  })

  it("stops offering the queue on a row the database already scheduled", async () => {
    // The list carries the item the question became, so a reload knows without
    // asking again -- and a second press cannot make a second card.
    mocks.listMistakes.mockResolvedValue([
      {
        id: "qa-old",
        subject: "physics",
        question: "上次排过的题",
        cause: "recall",
        knowledgeItemId: "k-mistake-1",
        createdAt: "2026-08-07T00:00:00Z",
      },
    ])

    render(<Practice />)
    await screen.findByText("上次排过的题")

    expect(screen.getByText("已排进复习")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^排进复习$/ })).not.toBeInTheDocument()
  })

  it("offers to mark a mistake as one you have since got right", async () => {
    // Offered on every cause, not just the ones review fixes: a 手滑 you have
    // learned to catch is as much a fixed mistake as a word you finally learnt.
    render(<Practice />)
    log("光合作用第 3 问", "算错 / 手滑")

    expect(await screen.findByRole("button", { name: /^订正$/ })).toBeInTheDocument()
  })

  it("keeps the row on the list after you put it right", async () => {
    // 订正 is not 删除. "I got this wrong once and fixed it" is the sentence the
    // log exists to be able to say, and a row that vanished could not say it.
    render(<Practice />)
    log("光合作用第 3 问", "看错题")
    await screen.findByText("光合作用第 3 问")

    fireEvent.click(screen.getByRole("button", { name: /^订正$/ }))

    expect(await screen.findByText("已订正")).toBeInTheDocument()
    expect(mocks.correctMistake).toHaveBeenCalledWith("qa-1")
    expect(screen.getByText("光合作用第 3 问")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^订正$/ })).not.toBeInTheDocument()
  })

  it("still counts a corrected mistake under the cause it happened for", async () => {
    // A bar that shrank on 订正 would erase the diagnosis as a reward for
    // acting on it. The count of what you fixed sits beside the chart instead.
    render(<Practice />)
    log("光合作用第 3 问", "看错题")
    await screen.findByText("光合作用第 3 问")

    fireEvent.click(screen.getByRole("button", { name: /^订正$/ }))
    await screen.findByText("已订正")

    expect(screen.getByText("另有原因 1")).toBeInTheDocument()
    expect(screen.getByText("已订正 1")).toBeInTheDocument()
  })

  it("leaves the row correctable when the mark could not be written", async () => {
    mocks.correctMistake.mockRejectedValueOnce(new Error("订正没写进去"))
    render(<Practice />)
    log("光合作用第 3 问", "看错题")
    await screen.findByText("光合作用第 3 问")

    fireEvent.click(screen.getByRole("button", { name: /^订正$/ }))

    expect(await screen.findByText(/订正没写进去/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^订正$/ })).toBeEnabled()
  })

  it("stops offering 订正 on a row the database already marked", async () => {
    // The mark is derived server-side from the retry itself, so a reload and a
    // press cannot disagree about whether this one was fixed.
    mocks.listMistakes.mockResolvedValue([
      {
        id: "qa-old",
        subject: "physics",
        question: "上次订正过的题",
        cause: "careless",
        corrected: true,
        createdAt: "2026-08-07T00:00:00Z",
      },
    ])

    render(<Practice />)
    await screen.findByText("上次订正过的题")

    expect(screen.getByText("已订正")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^订正$/ })).not.toBeInTheDocument()
  })
})
