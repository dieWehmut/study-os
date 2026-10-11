import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import { MemoryRouter } from "react-router-dom"

import Practice from "./Practice"

function renderPractice(initialEntry = "/practice") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Practice />
    </MemoryRouter>,
  )
}
import { mistakesStorageKey } from "@/lib/mistakes"
import { useSubjectStore } from "@/store/useSubjectStore"

const mocks = vi.hoisted(() => ({
  listMistakes: vi.fn(),
  recordMistake: vi.fn(),
  updateMistakeEvidence: vi.fn(),
  deleteMistake: vi.fn(),
  scheduleMistake: vi.fn(),
  correctMistake: vi.fn(),
  listErrorCauses: vi.fn(),
  exportMistakes: vi.fn(),
}))

vi.mock("@/api/mistakes", () => ({
  ...mocks,
  // The page reads a page of records together with its total. These cases only
  // ever needed the rows, so an array is read as a page exactly its own length --
  // the paging case below returns the object shape instead.
  listMistakePage: async (options?: unknown) => {
    const result = await mocks.listMistakes(options)
    return Array.isArray(result) ? { items: result, count: result.length } : result
  },
}))
vi.mock("@/api/error-causes", () => ({ listErrorCauses: mocks.listErrorCauses }))

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
    mocks.listErrorCauses.mockResolvedValue([])
    mocks.deleteMistake.mockResolvedValue(undefined)
    mocks.scheduleMistake.mockResolvedValue("k-mistake-1")
    mocks.updateMistakeEvidence.mockImplementation((id: string, evidence: unknown) =>
      Promise.resolve({
        id,
        subject: "math",
        question: "解方程",
        cause: "method",
        evidence,
        createdAt: "2026-08-09T00:00:00Z",
      }),
    )
    // 订正 answers with the row still a mistake, now carrying the mark. The
    // page reads the mark and keeps the text it already has, so the stub does
    // not need to echo the question back.
    mocks.correctMistake.mockImplementation((id: string, evidence: { answer: string; elapsedMs: number }) =>
      Promise.resolve({
        id,
        subject: "all",
        question: "题",
        cause: "method",
        corrected: true,
        correction: {
          answer: evidence.answer,
          elapsedMs: evidence.elapsedMs,
          occurredAt: "2026-08-09T00:00:00Z",
        },
        createdAt: "2026-08-09T00:00:00Z",
      }),
    )
  })

  it("says plainly that nothing has gone wrong yet", async () => {
    renderPractice()

    expect(await screen.findByText(/还没有记录/)).toBeInTheDocument()
  })

  it("filters the log by 错因, and asks the server for that one cause", async () => {
    // The taxonomy is the point of the log: "show me every method mistake" is how a
    // reader picks what to drill, and the total has to narrow with the list.
    mocks.listErrorCauses.mockResolvedValue([
      { id: "method", label: "方法不对", reviewFixes: true, sort_order: 0 },
      { id: "misread", label: "看错条件", reviewFixes: true, sort_order: 1 },
    ])
    renderPractice()
    await screen.findByText(/还没有记录/)

    fireEvent.click(screen.getByRole("combobox", { name: "按错因筛选" }))
    const option = await screen.findByRole("option", { name: "方法不对" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    await waitFor(() => expect(mocks.listMistakes).toHaveBeenCalledWith(
      expect.objectContaining({ cause: "method" }),
    ))
    expect(await screen.findByText(/只显示「方法不对」的错题/)).toBeInTheDocument()
  })

  it("opens already filtered when the link says so", async () => {
    // The dashboard's "还有 K 条错题没订正" sends the reader here with ?corrected=no.
    // A filter that only lived in memory would land them on the unfiltered log, which
    // is where the number they just read stops being true.
    renderPractice("/practice?corrected=no")

    await waitFor(() => expect(mocks.listMistakes).toHaveBeenCalledWith(
      expect.objectContaining({ corrected: "no" }),
    ))
    expect(document.querySelector("[data-corrected-filter='no']")).toHaveAttribute("aria-pressed", "true")
  })

  it("ignores a 订正 value it does not know instead of passing it on", async () => {
    renderPractice("/practice?corrected=maybe")

    await waitFor(() => expect(mocks.listMistakes).toHaveBeenCalled())
    expect(mocks.listMistakes).not.toHaveBeenCalledWith(expect.objectContaining({ corrected: "maybe" }))
    expect(document.querySelector("[data-corrected-filter='all']")).toHaveAttribute("aria-pressed", "true")
  })

  it("narrows the log to what is still open, and exports that same view", async () => {
    // The progress bar counts 订正 state; the chips make it a filter, because "what is
    // still open" is the list worth reading before a test. The file follows the screen.
    renderPractice()
    await screen.findByText(/还没有记录/)

    const chip = document.querySelector("[data-corrected-filter='no']")
    expect(chip).not.toBeNull()
    expect(chip!.textContent).toBe("未订正")
    fireEvent.click(chip!)

    await waitFor(() => expect(mocks.listMistakes).toHaveBeenCalledWith(
      expect.objectContaining({ corrected: "no" }),
    ))

    mocks.exportMistakes.mockResolvedValue("题干\n")
    const originalClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = vi.fn()
    URL.createObjectURL = vi.fn(() => "blob:open") as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    try {
      fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }))
      await waitFor(() => expect(mocks.exportMistakes).toHaveBeenCalledWith(
        expect.objectContaining({ corrected: "no" }),
      ))
    } finally {
      HTMLAnchorElement.prototype.click = originalClick
    }
  })

  it("does not call the log empty when the 订正 filter emptied it", async () => {
    renderPractice()
    await screen.findByText(/还没有记录/)

    fireEvent.click(document.querySelector("[data-corrected-filter='no']")!)

    expect(await screen.findByText(/没有还没订正的错题/)).toBeInTheDocument()
    expect(screen.queryByText(/还没有记录/)).not.toBeInTheDocument()
  })

  it("exports what the 错因 filter leaves on screen, not the whole log", async () => {
    // Filtering the list and then exporting is how a reader hands someone "my
    // method mistakes"; a file that quietly contains every mistake is wrong.
    mocks.listErrorCauses.mockResolvedValue([
      { id: "method", label: "方法不对", reviewFixes: true, sort_order: 0 },
    ])
    mocks.exportMistakes.mockResolvedValue("题干\n")
    renderPractice()
    await screen.findByText(/还没有记录/)

    fireEvent.click(screen.getByRole("combobox", { name: "按错因筛选" }))
    const option = await screen.findByRole("option", { name: "方法不对" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    const download = vi.fn()
    const originalClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = download
    URL.createObjectURL = vi.fn(() => "blob:filtered") as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    try {
      fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }))
      await waitFor(() => expect(mocks.exportMistakes).toHaveBeenCalledWith(
        expect.objectContaining({ cause: "method" }),
      ))
    } finally {
      HTMLAnchorElement.prototype.click = originalClick
    }
  })

  it("does not call the log empty when only the 错因 filter is", async () => {
    // "还没有记录" while a cause is selected reads as "you have never filed a
    // mistake", which is a different and wrong statement.
    mocks.listErrorCauses.mockResolvedValue([
      { id: "method", label: "方法不对", reviewFixes: true, sort_order: 0 },
    ])
    renderPractice()
    await screen.findByText(/还没有记录/)

    fireEvent.click(screen.getByRole("combobox", { name: "按错因筛选" }))
    const option = await screen.findByRole("option", { name: "方法不对" })
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    expect(await screen.findByText(/没有「方法不对」的错题/)).toBeInTheDocument()
    expect(screen.queryByText(/还没有记录/)).not.toBeInTheDocument()
  })

  it("shows a six-subject diagnostic overview and can focus a subject", async () => {
    renderPractice()

    expect(await screen.findByRole("heading", { name: "六科诊断总览" })).toBeInTheDocument()
    const subjectRows = screen.getAllByTestId("subject-diagnostic-row")
    expect(subjectRows).toHaveLength(6)

    const mathRow = subjectRows.find((row) => row.dataset.subject === "math")
    expect(mathRow).toBeDefined()
    fireEvent.click(mathRow as HTMLElement)
    await waitFor(() => expect(useSubjectStore.getState().subject).toBe("math"))
  })

  it("files a mistake under the cause you picked", async () => {
    renderPractice()
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
    renderPractice()
    log("速度与加速度", "想不起来")

    await waitFor(() => expect(screen.getByLabelText("错题")).toHaveValue(""))
  })

  it("says what it filed instead of leaving an empty box as the only sign", async () => {
    // An emptied input looks the same whether the write landed or you cleared
    // it yourself, and the row it created is far below this form.
    renderPractice()
    log("速度与加速度", "想不起来")

    expect(await screen.findByRole("status")).toHaveTextContent("已记下「速度与加速度」")

    // Typing the next one is a new thought; the old confirmation has to go.
    fireEvent.change(screen.getByLabelText("错题"), { target: { value: "下一题" } })
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("has nothing to file while the box is empty", async () => {
    renderPractice()

    expect(await screen.findByRole("button", { name: "想不起来" })).toBeDisabled()
  })

  it("finds an older mistake the first page of the log never carried", async () => {
    // The log is one page of the newest mistakes. Past that page the rest are
    // not hard to find -- they are not in the list at all.
    mocks.listMistakes.mockImplementation((options?: { query?: string }) =>
      Promise.resolve(
        options?.query
          ? [{ id: "qa-old", subject: "math", question: "求函数极值", cause: "method", createdAt: "2026-08-01T00:00:00Z" }]
          : [],
      ),
    )
    renderPractice()
    await waitFor(() => expect(mocks.listMistakes).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText("搜索错题内容"), { target: { value: "极值" } })
    fireEvent.click(screen.getByRole("button", { name: "搜索错题" }))

    await waitFor(() => expect(mocks.listMistakes).toHaveBeenCalledWith(expect.objectContaining({ query: "极值" })))
    expect(await screen.findByText("求函数极值")).toBeInTheDocument()
    expect(screen.getByText(/只显示题干提到「极值」的错题/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "清除" }))

    await waitFor(() => expect(screen.getByText(/还没有记录/)).toBeInTheDocument())
  })

  it("loads more of the log than the first page holds", async () => {
    // One page of 50, and the card knows how many there are: searching answers
    // "is it there", this answers "what else is".
    const first = { id: "qa-1", subject: "math", question: "第一页的题", cause: "method", createdAt: "2026-08-09T00:00:02Z" }
    const second = { id: "qa-2", subject: "math", question: "第二页的题", cause: "method", createdAt: "2026-08-09T00:00:01Z" }
    mocks.listMistakes.mockImplementation((options?: { offset?: number }) =>
      Promise.resolve(options?.offset ? { items: [second], count: 2 } : { items: [first], count: 2 }),
    )
    renderPractice()
    await screen.findByText("第一页的题")

    fireEvent.click(screen.getByRole("button", { name: "加载更多（还有 1 条）" }))

    await waitFor(() => expect(mocks.listMistakes).toHaveBeenCalledWith(expect.objectContaining({ offset: 1 })))
    expect(await screen.findByText("第二页的题")).toBeInTheDocument()
    // Nothing left, so nothing left to offer.
    expect(screen.queryByRole("button", { name: /加载更多/ })).not.toBeInTheDocument()
  })

  it("says how much of the log review can actually fix", async () => {
    // The rest of the app answers every wrong answer with "see it again
    // sooner". This is the number that says when that answer is wrong.
    renderPractice()
    log("第 1 题", "想不起来")
    await screen.findByText("第 1 题")
    log("第 2 题", "看错题")
    await screen.findByText("第 2 题")
    log("第 3 题", "算错 / 手滑")
    await screen.findByText("第 3 题")

    expect(screen.getByText("复习能解决 1")).toBeInTheDocument()
    expect(screen.getByText("另有原因 2")).toBeInTheDocument()
  })

  it("offers confirmed subject-specific causes and their persisted action", async () => {
    useSubjectStore.setState({ subject: "physics" })
    mocks.listErrorCauses.mockResolvedValueOnce([
      {
        id: "physics:model-selection",
        subject: "physics",
        label: "模型选择错误",
        reviewFixes: true,
        action: "重画受力图并选择模型",
        status: "confirmed",
        sortOrder: 20,
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
      },
    ])

    mocks.recordMistake.mockResolvedValueOnce({
      id: "qa-custom",
      subject: "physics",
      question: "模型选错的一题",
      cause: "physics:model-selection",
      createdAt: "2026-08-20T00:00:00Z",
    })
    renderPractice()

    expect(await screen.findByRole("button", { name: "模型选择错误" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("错题"), { target: { value: "模型选错的一题" } })
    fireEvent.click(screen.getByRole("button", { name: "模型选择错误" }))

    expect(await screen.findByText("模型选错的一题")).toBeInTheDocument()
    expect(screen.getByText("重画受力图并选择模型")).toBeInTheDocument()
    expect(mocks.recordMistake).toHaveBeenCalledWith({
      subject: "physics",
      question: "模型选错的一题",
      cause: "physics:model-selection",
    })
  })

  it("says what to do about a cause review will not fix", async () => {
    renderPractice()
    log("第 1 题", "看错题")

    expect(await screen.findByText(/圈出条件/)).toBeInTheDocument()
  })

  it("lets you take back a row you filed wrong", async () => {
    renderPractice()
    log("第 1 题", "看错题")
    await screen.findByText("第 1 题")

    fireEvent.click(screen.getByRole("button", { name: /删除/ }))

    await waitFor(() => expect(screen.queryByText("第 1 题")).not.toBeInTheDocument())
    expect(mocks.deleteMistake).toHaveBeenCalledWith("qa-1")
    expect(screen.getByText(/还没有记录/)).toBeInTheDocument()
  })

  it("puts the newest mistake on top, where you are looking", async () => {
    renderPractice()
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

    renderPractice()

    expect(await screen.findByText("上次记的题")).toBeInTheDocument()
    expect(screen.getByText("复习能解决 1")).toBeInTheDocument()
  })

  it("asks only for the subject in hand", async () => {
    useSubjectStore.setState({ subject: "physics" })

    renderPractice()

    await waitFor(() => expect(mocks.listMistakes).toHaveBeenCalledWith({ subject: "physics" }))
  })

  it("does not pretend a row was filed when the write failed", async () => {
    // A row that looks saved when nothing was written is worse than one that
    // failed loudly: you stop double-checking, and the log quietly diverges.
    mocks.recordMistake.mockRejectedValueOnce(new Error("网络断了"))
    renderPractice()
    await screen.findByText(/还没有记录/)

    fireEvent.change(screen.getByLabelText("错题"), { target: { value: "写不进去的题" } })
    fireEvent.click(screen.getByRole("button", { name: "看错题" }))

    expect(await screen.findByText(/网络断了/)).toBeInTheDocument()
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
    expect(screen.getByLabelText("错题")).toHaveValue("写不进去的题")
  })

  it("shows the server's own reason rather than a guess about the backend", async () => {
    // 记录错题失败 is the same sentence either way; what differs is whether the
    // server answered. Asking the reader to check a backend that just replied
    // would be false, and it hides the reason the server sent.
    mocks.recordMistake.mockRejectedValueOnce(new ApiError(500, "保存错题失败"))
    renderPractice()
    await screen.findByText(/还没有记录/)

    fireEvent.change(screen.getByLabelText("错题"), { target: { value: "写不进去的题" } })
    fireEvent.click(screen.getByRole("button", { name: "看错题" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("记录错题失败：保存错题失败")
    expect(alert).not.toHaveTextContent("请确认本地后端正在运行")
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

    renderPractice()

    expect(await screen.findByText("新一点的")).toBeInTheDocument()
    expect(screen.getByText("旧一点的")).toBeInTheDocument()
    // Oldest first, so the newest still lands on top once the server has them.
    expect(mocks.recordMistake.mock.calls.map((call) => call[0].question)).toEqual(["旧一点的", "新一点的"])
    // Clearing the key is what makes it once rather than every mount.
    await waitFor(() => expect(localStorage.getItem(mistakesStorageKey)).toBeNull())
  })

  it("carries subject evidence with a browser-local mistake before clearing it", async () => {
    const evidence = {
      version: 1 as const,
      subject: "math" as const,
      tool: "derivation" as const,
      data: { lines: ["2x+4=10", "2x=6", "x=3"] },
    }
    localStorage.setItem(
      mistakesStorageKey,
      JSON.stringify([
        {
          id: "old-with-evidence",
          subject: "math",
          question: "解方程 2x+4=10",
          cause: "method",
          evidence,
          createdAt: "2026-08-07T00:00:00Z",
        },
      ]),
    )
    mocks.recordMistake.mockResolvedValueOnce({
      id: "qa-evidence",
      subject: "math",
      question: "解方程 2x+4=10",
      cause: "method",
      evidence,
      createdAt: "2026-08-09T00:00:00Z",
    })

    renderPractice()

    await waitFor(() => {
      expect(mocks.recordMistake).toHaveBeenCalledWith({
        subject: "math",
        question: "解方程 2x+4=10",
        cause: "method",
        evidence,
      })
    })
    await waitFor(() => expect(localStorage.getItem(mistakesStorageKey)).toBeNull())
  })

  it("opens and saves the dedicated tool on the concrete mistake row", async () => {
    useSubjectStore.setState({ subject: "math" })
    mocks.listMistakes.mockResolvedValueOnce([
      {
        id: "qa-math",
        subject: "math",
        question: "解方程",
        cause: "method",
        evidence: {
          version: 1,
          subject: "math",
          tool: "derivation",
          data: { lines: ["2x+4=10", "2x=6"] },
        },
        createdAt: "2026-08-09T00:00:00Z",
      },
    ])

    renderPractice()

    fireEvent.click(await screen.findByRole("button", { name: "继续诊断" }))
    const derivation = screen.getByLabelText("把过程一行一行写下来")
    expect(derivation).toHaveValue("2x+4=10\n2x=6")
    fireEvent.change(derivation, { target: { value: "2x+4=10\n2x=6\nx=3" } })
    fireEvent.click(screen.getByRole("button", { name: "保存诊断证据" }))

    await waitFor(() => {
      expect(mocks.updateMistakeEvidence).toHaveBeenCalledWith("qa-math", {
        version: 1,
        subject: "math",
        tool: "derivation",
        data: { lines: ["2x+4=10", "2x=6", "x=3"] },
      })
    })
    expect(screen.getByRole("status")).toHaveTextContent("已保存")
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

    renderPractice()

    expect(await screen.findByText(/网络断了/)).toBeInTheDocument()
    expect(localStorage.getItem(mistakesStorageKey)).not.toBeNull()
  })

  it("offers to queue the one kind of mistake more review actually fixes", async () => {
    // Until now the page could only *say* 想不起来 is what review repairs. The
    // button is what makes the sentence do something.
    renderPractice()
    log("速度与加速度", "想不起来")
    await screen.findByText("速度与加速度")

    expect(screen.getByRole("button", { name: /^排进复习$/ })).toBeInTheDocument()
  })

  it("does not offer the queue on a mistake review will not fix", async () => {
    // Rescheduling a card you misread reshuffles something that was never the
    // problem, and the mistake comes back looking like a memory failure it
    // never was. The row already says what to do instead.
    renderPractice()
    log("光合作用第 3 问", "看错题")
    await screen.findByText("光合作用第 3 问")

    expect(screen.queryByRole("button", { name: /排进复习/ })).not.toBeInTheDocument()
  })

  it("marks the row queued once the card was written", async () => {
    renderPractice()
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
    renderPractice()
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
    renderPractice()
    log("斜面上的木块", "思路不对")

    // Anchored on the sentence's own wording: the button it now offers says
    // 画受力图, and a bare /受力图/ would match both and assert neither.
    expect(await screen.findByText(/重画受力图/)).toBeInTheDocument()
  })

  it("keeps to the shared advice while the log mixes every subject", async () => {
    // 全部学科 is the default, and a sentence naming 受力图 would then sit under
    // a bar counting 语文 rows too.
    renderPractice()
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

    renderPractice()
    await screen.findByText("上次排过的题")

    expect(screen.getByText("已排进复习")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^排进复习$/ })).not.toBeInTheDocument()
  })

  it("offers to mark a mistake as one you have since got right", async () => {
    // Offered on every cause, not just the ones review fixes: a 手滑 you have
    // learned to catch is as much a fixed mistake as a word you finally learnt.
    renderPractice()
    log("光合作用第 3 问", "算错 / 手滑")

    fireEvent.click(await screen.findByRole("button", { name: /^订正$/ }))

    expect(screen.getByLabelText("订正答案")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /提交订正/ })).toBeDisabled()
  })

  it("keeps the row on the list after you put it right", async () => {
    // 订正 is not 删除. "I got this wrong once and fixed it" is the sentence the
    // log exists to be able to say, and a row that vanished could not say it.
    renderPractice()
    log("光合作用第 3 问", "看错题")
    await screen.findByText("光合作用第 3 问")

    fireEvent.click(screen.getByRole("button", { name: /^订正$/ }))

    fireEvent.change(screen.getByLabelText("订正答案"), { target: { value: "6 N" } })
    fireEvent.click(screen.getByRole("button", { name: /提交订正/ }))

    expect(await screen.findByText("已订正")).toBeInTheDocument()
    expect(mocks.correctMistake).toHaveBeenCalledWith("qa-1", expect.objectContaining({ answer: "6 N", elapsedMs: expect.any(Number) }))
    expect(screen.getByText("光合作用第 3 问")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^订正$/ })).not.toBeInTheDocument()
    expect(screen.getByText(/答案：6 N/)).toBeInTheDocument()
  })

  it("still counts a corrected mistake under the cause it happened for", async () => {
    // A bar that shrank on 订正 would erase the diagnosis as a reward for
    // acting on it. The count of what you fixed sits beside the chart instead.
    renderPractice()
    log("光合作用第 3 问", "看错题")
    await screen.findByText("光合作用第 3 问")

    fireEvent.click(screen.getByRole("button", { name: /^订正$/ }))
    fireEvent.change(screen.getByLabelText("订正答案"), { target: { value: "6 N" } })
    fireEvent.click(screen.getByRole("button", { name: /提交订正/ }))
    await screen.findByText("已订正")

    expect(screen.getByText("另有原因 1")).toBeInTheDocument()
    expect(screen.getByText("已订正 1")).toBeInTheDocument()
    // And how far through the log that is, as its own row: one of one fixed.
    const progress = document.querySelector("[data-correction-progress='true']")
    expect(progress).not.toBeNull()
    expect(progress!.textContent).toContain("订正进度 1/1")
  })

  it("leaves the row correctable when the mark could not be written", async () => {
    mocks.correctMistake.mockRejectedValueOnce(new Error("订正没写进去"))
    renderPractice()
    log("光合作用第 3 问", "看错题")
    await screen.findByText("光合作用第 3 问")

    fireEvent.click(screen.getByRole("button", { name: /^订正$/ }))

    fireEvent.change(screen.getByLabelText("订正答案"), { target: { value: "6 N" } })
    fireEvent.click(screen.getByRole("button", { name: /提交订正/ }))

    expect(await screen.findByText(/订正没写进去/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /提交订正/ })).toBeEnabled()
  })

  it("lets the learner cancel an open correction without writing", async () => {
    renderPractice()
    log("光合作用第 3 问", "看错题")
    await screen.findByText("光合作用第 3 问")

    fireEvent.click(screen.getByRole("button", { name: /^订正$/ }))
    fireEvent.change(screen.getByLabelText("订正答案"), { target: { value: "不会提交" } })
    fireEvent.click(screen.getByRole("button", { name: /取消订正/ }))

    expect(screen.queryByLabelText("订正答案")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^订正$/ })).toBeInTheDocument()
    expect(mocks.correctMistake).not.toHaveBeenCalled()
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

    renderPractice()
    await screen.findByText("上次订正过的题")

    expect(screen.getByText("已订正")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^订正$/ })).not.toBeInTheDocument()
  })
})

describe("drawing the 受力图 物理 keeps being told to draw", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    filed = 0
    useSubjectStore.setState({ subject: "physics" })
    mocks.listMistakes.mockResolvedValue([])
  })

  it("offers the board where the advice to draw one is printed", async () => {
    // 物理's 思路不对 advice says "重画受力图，先标接触面再标场力". A sentence
    // telling you to do something the app cannot do is worse than no sentence.
    renderPractice()
    log("斜面上的滑块", "思路不对")

    expect(await screen.findByRole("button", { name: "画受力图" })).toBeInTheDocument()
  })

  it("opens a real board, not a picture of one", async () => {
    renderPractice()
    log("斜面上的滑块", "思路不对")
    fireEvent.click(await screen.findByRole("button", { name: "画受力图" }))

    fireEvent.change(screen.getByLabelText("力的名称"), { target: { value: "重力" } })
    fireEvent.change(screen.getByLabelText("大小（N）"), { target: { value: "10" } })
    fireEvent.change(screen.getByLabelText("方向（度）"), { target: { value: "270" } })
    fireEvent.click(screen.getByRole("button", { name: "场力" }))
    fireEvent.click(screen.getByRole("button", { name: "加上这个力" }))

    expect(screen.getByText(/10\.0 N/)).toBeInTheDocument()
  })

  it("does not offer a 受力图 to 语文", async () => {
    // The board is 物理's own tool. Offering it under 默写不出来 would be the
    // generic-advice problem the per-subject table was written to end.
    useSubjectStore.setState({ subject: "chinese" })
    renderPractice()
    log("默写第三句", "思路不对")

    await screen.findByText("默写第三句")
    expect(screen.queryByRole("button", { name: "画受力图" })).not.toBeInTheDocument()
  })
})

describe("dividing the process 物理 keeps being told to divide", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    filed = 0
    useSubjectStore.setState({ subject: "physics" })
    mocks.listMistakes.mockResolvedValue([])
  })

  it("offers the board under the advice that asks for it", async () => {
    // 物理's 看错题 advice says "先把过程分段，写出每段的初末状态" -- another
    // sentence the app has been printing without being able to carry it out.
    renderPractice()
    log("小球落地前后", "看错题")

    expect(await screen.findByRole("button", { name: "把过程分段" })).toBeInTheDocument()
  })

  it("opens a real board, not a picture of one", async () => {
    renderPractice()
    log("小球落地前后", "看错题")
    fireEvent.click(await screen.findByRole("button", { name: "把过程分段" }))

    fireEvent.change(screen.getByLabelText("这一段叫什么"), { target: { value: "自由下落" } })
    fireEvent.change(screen.getByLabelText("初速度（m/s）"), { target: { value: "0" } })
    fireEvent.change(screen.getByLabelText("加速度（m/s²）"), { target: { value: "10" } })
    fireEvent.change(screen.getByLabelText("时间（s）"), { target: { value: "2" } })
    fireEvent.click(screen.getByRole("button", { name: "加上这一段" }))

    expect(screen.getByText("末速度 20 m/s")).toBeInTheDocument()
  })

  it("shows one board at a time, the one whose advice you opened", async () => {
    // Both boards hang off the same 物理 log. Two open at once would leave the
    // 受力图 sitting under a sentence about 分段, which is the generic-advice
    // problem again, one level down.
    renderPractice()
    log("斜面上的滑块", "思路不对")
    // Awaited before the second: filing sets busy, which disables every cause
    // button until the write comes back, so a click fired now lands on nothing.
    await screen.findByText("斜面上的滑块")
    log("小球落地前后", "看错题")

    fireEvent.click(await screen.findByRole("button", { name: "画受力图" }))
    fireEvent.click(screen.getByRole("button", { name: "把过程分段" }))

    expect(screen.getByLabelText("这一段叫什么")).toBeInTheDocument()
    expect(screen.queryByLabelText("力的名称")).not.toBeInTheDocument()
  })

  it("does not offer 分段 to 地理", async () => {
    useSubjectStore.setState({ subject: "geography" })
    renderPractice()
    log("等高线判读", "看错题")

    await screen.findByText("等高线判读")
    expect(screen.queryByRole("button", { name: "把过程分段" })).not.toBeInTheDocument()
  })
})

describe("re-checking the 配平 化学 keeps being told to re-check", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    filed = 0
    useSubjectStore.setState({ subject: "chemistry" })
    mocks.listMistakes.mockResolvedValue([])
  })

  it("offers the board under the advice that asks for it", async () => {
    // 化学's 手滑 advice says "配平系数和状态符号回查一遍" -- an instruction to
    // re-read your own handwriting, which is what already failed.
    renderPractice()
    log("氢氧化钙受热", "算错 / 手滑")

    expect(await screen.findByRole("button", { name: "核对配平" })).toBeInTheDocument()
  })

  it("opens a real board, not a picture of one", async () => {
    renderPractice()
    log("氢氧化钙受热", "算错 / 手滑")
    fireEvent.click(await screen.findByRole("button", { name: "核对配平" }))

    fireEvent.change(screen.getByLabelText("化学方程式"), { target: { value: "H2 + O2 = H2O" } })

    expect(screen.getByRole("alert")).toHaveTextContent("O：左 2，右 1")
  })

  it("does not offer 配平 to 数学", async () => {
    useSubjectStore.setState({ subject: "math" })
    renderPractice()
    log("求导算错", "算错 / 手滑")

    await screen.findByText("求导算错")
    expect(screen.queryByRole("button", { name: "核对配平" })).not.toBeInTheDocument()
  })
})

describe("locating the step 数学 keeps being told to locate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    filed = 0
    useSubjectStore.setState({ subject: "math" })
    mocks.listMistakes.mockResolvedValue([])
  })

  it("offers the board under the advice that asks for it", async () => {
    // 数学's 思路不对 advice says "定位到出错的那一步，而不是整题重做" -- and
    // finding that step by re-reading is exactly what does not work, since
    // every line below the break still follows from the one above it.
    renderPractice()
    log("解一元二次方程", "思路不对")

    expect(await screen.findByRole("button", { name: "逐行核对" })).toBeInTheDocument()
  })

  it("opens a real board, not a picture of one", async () => {
    renderPractice()
    log("解一元二次方程", "思路不对")
    fireEvent.click(await screen.findByRole("button", { name: "逐行核对" }))

    fireEvent.change(screen.getByLabelText("把过程一行一行写下来"), {
      target: { value: "2x+4=10\n2x=6\nx=4" },
    })

    expect(screen.getByRole("alert")).toHaveTextContent("第 3 行")
  })

  it("leaves 物理's 思路不对 with the drawing it already asks for", async () => {
    // Both subjects call the cause 思路不对 and mean different things by it:
    // 物理's is the wrong model, and the fix is a 受力图, not a line check.
    useSubjectStore.setState({ subject: "physics" })
    renderPractice()
    log("斜面上的木块", "思路不对")

    expect(await screen.findByRole("button", { name: "画受力图" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "逐行核对" })).not.toBeInTheDocument()
  })
})

describe("writing out the 因果链 地理 keeps being told to write out", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    filed = 0
    useSubjectStore.setState({ subject: "geography" })
    mocks.listMistakes.mockResolvedValue([])
  })

  it("offers the board under the advice that asks for it", async () => {
    // 地理's 思路不对 advice says 把因果链一环一环写出来，缺哪一环就是丢分点 --
    // and a chain read back as prose joins up in your head, gap and all.
    renderPractice()
    log("撒哈拉为什么干旱", "思路不对")

    expect(await screen.findByRole("button", { name: "串因果链" })).toBeInTheDocument()
  })

  it("opens a real board, not a picture of one", async () => {
    renderPractice()
    log("撒哈拉为什么干旱", "思路不对")
    fireEvent.click(await screen.findByRole("button", { name: "串因果链" }))

    fireEvent.change(screen.getByLabelText("成因"), { target: { value: "常年受副高控制" } })
    fireEvent.change(screen.getByLabelText("结果"), { target: { value: "盛行下沉气流" } })
    fireEvent.click(screen.getByRole("button", { name: "加上这一环" }))
    fireEvent.change(screen.getByLabelText("成因"), { target: { value: "沿岸有寒流" } })
    fireEvent.change(screen.getByLabelText("结果"), { target: { value: "降水稀少" } })
    fireEvent.click(screen.getByRole("button", { name: "加上这一环" }))

    expect(screen.getByRole("alert")).toHaveTextContent("盛行下沉气流")
  })

  it("leaves 数学's 思路不对 with the line check it already asks for", async () => {
    // Three subjects now call the cause 思路不对 and mean three different
    // things by it. The board is picked by the pair, never by the cause alone.
    useSubjectStore.setState({ subject: "math" })
    renderPractice()
    log("解一元二次方程", "思路不对")

    expect(await screen.findByRole("button", { name: "逐行核对" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "串因果链" })).not.toBeInTheDocument()
  })
})

describe("pulling the answer apart 语文 keeps being told to pull apart", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    filed = 0
    useSubjectStore.setState({ subject: "chinese" })
    mocks.listMistakes.mockResolvedValue([])
  })

  it("offers the board under the advice that asks for it", async () => {
    // 语文's 思路不对 advice says 对着得分点拆答案：踩到几个点，缺的是哪一类 --
    // and your own answer always reads complete, because you wrote all of it.
    renderPractice()
    log("赏析这两句诗", "思路不对")

    expect(await screen.findByRole("button", { name: "对得分点" })).toBeInTheDocument()
  })

  it("opens a real board, not a picture of one", async () => {
    renderPractice()
    log("赏析这两句诗", "思路不对")
    fireEvent.click(await screen.findByRole("button", { name: "对得分点" }))

    fireEvent.change(screen.getByLabelText("标准答案的得分点"), {
      target: { value: "借景抒情\n对比手法" },
    })
    fireEvent.change(screen.getByLabelText("你写的答案"), {
      target: { value: "这两句借景抒情。" },
    })

    expect(screen.getByRole("alert")).toHaveTextContent("对比手法")
  })

  it("does not offer 得分点 to 地理, which is told to chain causes instead", async () => {
    useSubjectStore.setState({ subject: "geography" })
    renderPractice()
    log("撒哈拉为什么干旱", "思路不对")

    expect(await screen.findByRole("button", { name: "串因果链" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "对得分点" })).not.toBeInTheDocument()
  })
})

describe("taking apart the 长难句 英语 keeps being told to look at structurally", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    filed = 0
    useSubjectStore.setState({ subject: "english" })
    mocks.listMistakes.mockResolvedValue([])
  })

  it("offers the board under the advice that asks for it", async () => {
    // 英语's 思路不对 advice says 语法题看结构不看词义：先找主谓，再定从句 -- and
    // 找主谓 is the half that fails, because the two are pushed apart by
    // everything hanging off the subject.
    renderPractice()
    log("这句从句套从句读不动", "思路不对")

    expect(await screen.findByRole("button", { name: "拆长难句" })).toBeInTheDocument()
  })

  it("opens a real board, not a picture of one", async () => {
    renderPractice()
    log("这句从句套从句读不动", "思路不对")
    fireEvent.click(await screen.findByRole("button", { name: "拆长难句" }))

    fireEvent.change(screen.getByLabelText("这句长难句"), {
      target: { value: "The book that I bought yesterday is on the table." },
    })

    expect(screen.getByText("The book … is on the table.")).toBeInTheDocument()
  })

  it("does not offer 长难句 to 语文, which is told to check 得分点 instead", async () => {
    useSubjectStore.setState({ subject: "chinese" })
    renderPractice()
    log("赏析这两句诗", "思路不对")

    expect(await screen.findByRole("button", { name: "对得分点" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "拆长难句" })).not.toBeInTheDocument()
  })

  it("hands the whole 错题本 over as a file, not just the page on screen", async () => {
    // The list shows the newest fifty; a file that stopped there would look
    // complete and be a fragment.
    useSubjectStore.setState({ subject: "all" })
    mocks.exportMistakes.mockResolvedValue("题干,学科,错因\n斜面上的木块受力,physics,思路不对\n")
    const downloads: string[] = []
    const originalClick = HTMLAnchorElement.prototype.click
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      downloads.push(this.download)
    }
    URL.createObjectURL = vi.fn(() => "blob:mistakes") as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    try {
      renderPractice()
      fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }))

      await waitFor(() => expect(mocks.exportMistakes).toHaveBeenCalledWith({ subject: undefined, query: undefined, cause: undefined }))
      expect(downloads[0]).toMatch(/错题.*\.csv$/)
      await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mistakes"))
    } finally {
      HTMLAnchorElement.prototype.click = originalClick
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  it("says so when the 错题本 cannot be exported", async () => {
    mocks.exportMistakes.mockRejectedValue(new Error("导出错题失败"))
    renderPractice()

    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("导出错题失败")
    expect(screen.getByRole("button", { name: "导出 CSV" })).toBeEnabled()
  })
})
