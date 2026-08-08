import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"

import { takeAskDraft } from "@/lib/ask-draft"
import { readReadingSession } from "@/lib/reading-session"
import Reading from "./Reading"

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
