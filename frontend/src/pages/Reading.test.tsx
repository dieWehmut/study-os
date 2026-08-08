import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { takeAskDraft } from "@/lib/ask-draft"
import { readReadingSession } from "@/lib/reading-session"
import Reading from "./Reading"

const mocks = vi.hoisted(() => ({ dumpThought: vi.fn() }))

vi.mock("@/api/chat", () => ({ dumpThought: mocks.dumpThought }))

const source = ["# 光合作用", "## 光反应", "在类囊体薄膜上进行。", "## 暗反应", "在叶绿体基质中进行。"].join("\n")

function renderReading() {
  return render(
    <MemoryRouter>
      <Reading />
    </MemoryRouter>,
  )
}

function paste(markdown: string) {
  fireEvent.change(screen.getByLabelText("原文"), { target: { value: markdown } })
}

describe("Reading page", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("moves you on once a stop is done, so the mark doubles as a page turn", () => {
    // Marking and then reaching for 下一节 is two actions for one intent.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))

    expect(screen.getByText("2 / 2")).toBeInTheDocument()
  })

  it("remembers a stop was finished after you walk back to it", () => {
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))
    fireEvent.click(screen.getByRole("button", { name: /上一节/ }))

    expect(screen.getByRole("button", { name: /已读完/ })).toBeInTheDocument()
  })

  it("lets you take a mark back", () => {
    // Marking the wrong stop is easy; a record you cannot correct stops being
    // a record of what you read.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))
    fireEvent.click(screen.getByRole("button", { name: /上一节/ }))
    fireEvent.click(screen.getByRole("button", { name: /已读完/ }))

    expect(screen.getByRole("button", { name: /读完/ })).toHaveAttribute("aria-pressed", "false")
  })

  it("stays on the last stop rather than pretending there is another one", () => {
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))
    fireEvent.click(screen.getByRole("button", { name: /读完/ }))

    expect(screen.getByText("2 / 2")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /已读完/ })).toBeInTheDocument()
  })

  it("carries the marks into the outline, where the whole document is visible", () => {
    // The reader only ever shows one stop, so it can say "this one is done"
    // but never "you are two of three through". The outline is where that
    // question is answerable.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))

    expect(screen.getByText("已读 1 / 2")).toBeInTheDocument()
  })

  it("shows the document's stops once something is pasted", () => {
    renderReading()
    paste(source)

    expect(screen.getByRole("button", { name: /光反应/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /暗反应/ })).toBeInTheDocument()
  })

  it("keeps the map folded away until it is asked for", () => {
    // The outline, the prose and a full map on screen at once is the same wall
    // of information the preview exists to avoid.
    renderReading()
    paste(source)

    expect(screen.queryByRole("tree")).not.toBeInTheDocument()
  })

  it("draws the map from the text already pasted, with no second paste box", () => {
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /看导图/ }))

    expect(screen.getByRole("tree", { name: "导图：光合作用" })).toBeInTheDocument()
    expect(screen.getByRole("treeitem", { name: "暗反应" })).toBeInTheDocument()
    expect(screen.getAllByLabelText("原文")).toHaveLength(1)
  })

  it("puts the map away again", () => {
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /看导图/ }))
    fireEvent.click(screen.getByRole("button", { name: /收起导图/ }))

    expect(screen.queryByRole("tree")).not.toBeInTheDocument()
  })

  it("has no map to offer before anything is pasted", () => {
    renderReading()

    expect(screen.queryByRole("button", { name: /看导图/ })).not.toBeInTheDocument()
  })

  it("hands the document back when you come again", () => {
    // Re-pasting the lecture notes every session is the cost that stops this
    // from being somewhere you actually read.
    const first = renderReading()
    paste(source)
    first.unmount()

    renderReading()

    expect(screen.getByLabelText("原文")).toHaveValue(source)
    expect(screen.getByRole("button", { name: /光反应/ })).toBeInTheDocument()
  })

  it("puts you back at the stop you left off on, still marked", () => {
    const first = renderReading()
    paste(source)
    fireEvent.click(screen.getByRole("button", { name: /读完/ }))
    first.unmount()

    renderReading()

    expect(screen.getByText("2 / 2")).toBeInTheDocument()
    expect(screen.getByText("已读 1 / 2")).toBeInTheDocument()
  })

  it("stops offering a document you have cleared away", () => {
    const first = renderReading()
    paste(source)
    paste("")
    first.unmount()

    renderReading()

    expect(screen.getByLabelText("原文")).toHaveValue("")
  })

  it("does not restore a place past the end of a shortened document", () => {
    // The stored place belongs to the document that produced it. A shorter one
    // read back would leave the reader pointing at a stop that is not there.
    localStorage.setItem(
      "study-os.reading",
      JSON.stringify({ markdown: "# 一\n只有一节。", index: 9, readIds: [] }),
    )

    renderReading()

    expect(screen.getByText("1 / 1")).toBeInTheDocument()
  })

  it("saves the marks as they are made, not only when you leave", () => {
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))

    expect(readReadingSession().readIds).toHaveLength(1)
  })
})

describe("collecting what you got stuck on", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("keeps you on the stop you did not understand", () => {
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))

    expect(screen.getByText("1 / 2")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /卡住了/ })).toBeInTheDocument()
  })

  it("keeps the flag after you close the tab and come back", () => {
    const first = renderReading()
    paste(source)
    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))
    first.unmount()

    renderReading()

    expect(screen.getByRole("button", { name: /卡住了/ })).toBeInTheDocument()
  })

  it("lets you take the flag back once the section lands", () => {
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))
    fireEvent.click(screen.getByRole("button", { name: /卡住了/ }))

    expect(readReadingSession().stuckIds).toEqual([])
  })

  it("records being stuck without claiming the stop is finished", () => {
    // The two marks answer different questions. Flagging one must not quietly
    // tick it off as read.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))

    expect(readReadingSession().readIds).toEqual([])
  })

  it("gathers the flagged stops into one list, which is what a preview pass is for", () => {
    // The reader shows one stop at a time, so it can never answer "what do I
    // still not understand?" -- and that list is the whole output of reading
    // for structure first.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))

    expect(screen.getByRole("button", { name: "卡住：光反应" })).toBeInTheDocument()
  })

  it("takes you back to a flagged stop when you pick it off the list", () => {
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))
    fireEvent.click(screen.getByRole("button", { name: /下一节/ }))
    fireEvent.click(screen.getByRole("button", { name: "卡住：光反应" }))

    expect(screen.getByText("1 / 2")).toBeInTheDocument()
  })

  it("says nothing about being stuck when nothing is flagged", () => {
    renderReading()
    paste(source)

    expect(screen.queryByText("卡住的地方")).not.toBeInTheDocument()
  })

  it("carries the flag into the outline, where the whole document is visible", () => {
    // The list under the reader says which sections are in the way; the outline
    // says where they sit in the document -- which is what decides whether the
    // gap is one stubborn paragraph or a whole branch you never got.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))

    // Two views of the same document now name this section: the outline and the
    // list under the reader. data-depth is the outline's own marker.
    const outlined = screen
      .getAllByRole("button", { name: /光反应/ })
      .filter((button) => button.dataset.depth !== undefined)
    expect(outlined).toHaveLength(1)
    expect(outlined[0]).toHaveAccessibleName(/卡住/)
    expect(screen.getByText("卡住 1")).toBeInTheDocument()
  })

  it("drops a flag naming a stop the edited document no longer has", () => {
    // The marks were made against a longer draft; a stale id would list a
    // section nobody can navigate to.
    localStorage.setItem(
      "study-os.reading",
      JSON.stringify({ markdown: "# 一\n只有一节。", index: 0, readIds: [], stuckIds: ["gone"] }),
    )

    renderReading()

    expect(screen.queryByText("卡住的地方")).not.toBeInTheDocument()
  })
})

describe("taking what you got stuck on to 答疑", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("offers no way to ask when nothing is in the way", () => {
    renderReading()
    paste(source)

    expect(screen.queryByRole("link", { name: /去问/ })).not.toBeInTheDocument()
  })

  it("carries the flagged sections and their words, not just their headings", () => {
    // Whoever answers never saw the document. Headings alone are titles with
    // nothing under them.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))
    fireEvent.click(screen.getByRole("link", { name: /去问/ }))

    const question = takeAskDraft()
    expect(question).toContain("光合作用 / 光反应")
    expect(question).toContain("在类囊体薄膜上进行。")
  })

  it("carries every flagged section, because the gap is the whole set", () => {
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))
    fireEvent.click(screen.getByRole("button", { name: /下一节/ }))
    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))
    fireEvent.click(screen.getByRole("link", { name: /去问/ }))

    const question = takeAskDraft()
    expect(question).toContain("在类囊体薄膜上进行。")
    expect(question).toContain("在叶绿体基质中进行。")
  })

  it("goes to 答疑, where the question can actually be answered", () => {
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))

    expect(screen.getByRole("link", { name: /去问/ })).toHaveAttribute("href", "/chat")
  })
})

describe("keeping the documents you close", () => {
  const kinetics = ["# 动能定理", "## 适用条件", "只对合外力做功成立。"].join("\n")

  beforeEach(() => {
    localStorage.clear()
  })

  it("offers nothing to put away while the box is empty", () => {
    renderReading()

    expect(screen.queryByRole("button", { name: /收起这篇/ })).not.toBeInTheDocument()
  })

  it("keeps the document you close instead of losing it to the next paste", () => {
    // The box holds one document, so a second paste used to destroy the first
    // with no way back.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /收起这篇/ }))

    expect(screen.getByLabelText("原文")).toHaveValue("")
    expect(screen.getByRole("button", { name: "打开 光合作用" })).toBeInTheDocument()
  })

  it("says how far you got on each one you closed, which is what picks the next", () => {
    renderReading()
    paste(source)
    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))

    fireEvent.click(screen.getByRole("button", { name: /收起这篇/ }))

    expect(screen.getByText(/1 节没看懂/)).toBeInTheDocument()
  })

  it("opens one you closed with every mark still on it", () => {
    // The marks are the work. Handing back only the text would make the shelf
    // a paste buffer.
    renderReading()
    paste(source)
    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))
    fireEvent.click(screen.getByRole("button", { name: /收起这篇/ }))
    paste(kinetics)

    fireEvent.click(screen.getByRole("button", { name: "打开 光合作用" }))

    expect(screen.getByLabelText("原文")).toHaveValue(source)
    expect(readReadingSession().stuckIds).toEqual(["n0-0-p0"])
  })

  it("puts the one you were reading on the shelf, rather than dropping it for the swap", () => {
    renderReading()
    paste(source)
    fireEvent.click(screen.getByRole("button", { name: /收起这篇/ }))
    paste(kinetics)

    fireEvent.click(screen.getByRole("button", { name: "打开 光合作用" }))

    expect(screen.getByRole("button", { name: "打开 动能定理" })).toBeInTheDocument()
  })

  it("throws one away without opening it, since a shelf you only add to is unreadable", () => {
    renderReading()
    paste(source)
    fireEvent.click(screen.getByRole("button", { name: /收起这篇/ }))

    fireEvent.click(screen.getByRole("button", { name: "扔掉 光合作用" }))

    expect(screen.queryByRole("button", { name: /光合作用/ })).not.toBeInTheDocument()
  })

  it("does not open the document on its way to the bin", () => {
    // The row and its 扔掉 sit on top of each other; a click that both deletes
    // and loads would replace what you are reading with what you discarded.
    renderReading()
    paste(source)
    fireEvent.click(screen.getByRole("button", { name: /收起这篇/ }))
    paste(kinetics)

    fireEvent.click(screen.getByRole("button", { name: "扔掉 光合作用" }))

    expect(screen.getByLabelText("原文")).toHaveValue(kinetics)
  })
})

describe("keeping a section that landed", () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.dumpThought.mockReset()
    mocks.dumpThought.mockResolvedValue({ id: "dump-1", term: "光合作用 / 光反应" })
  })

  it("files the section under its place in the document, with its own words", () => {
    // 预习 that produces nothing but a finished progress bar is reading you
    // cannot bank. This is the one path out of it into 复习.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /收进知识库/ }))

    return waitFor(() => {
      const note = mocks.dumpThought.mock.calls[0][0] as string
      expect(note.startsWith("光合作用 / 光反应")).toBe(true)
      expect(note).toContain("在类囊体薄膜上进行。")
    })
  })

  it("will not file the same section twice", async () => {
    // There is no undo in the library, so a second click is a duplicate you
    // then have to find and delete.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /收进知识库/ }))

    await waitFor(() => expect(screen.getByRole("button", { name: /已收进/ })).toBeDisabled())
    expect(mocks.dumpThought).toHaveBeenCalledTimes(1)
  })

  it("says so when the library cannot be reached, rather than looking saved", async () => {
    mocks.dumpThought.mockRejectedValue(new Error("offline"))
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /收进知识库/ }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/收进知识库/)
    expect(screen.getByRole("button", { name: /收进知识库/ })).toBeEnabled()
  })

  it("files nothing just because you turned the page", () => {
    // 读完 is a navigation act. Conflating it with this would put every
    // paragraph you skimmed into the library.
    renderReading()
    paste(source)

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))

    expect(mocks.dumpThought).not.toHaveBeenCalled()
  })

  it("offers nothing to keep while there is no section on screen", () => {
    renderReading()

    expect(screen.queryByRole("button", { name: /收进知识库/ })).not.toBeInTheDocument()
  })
})
