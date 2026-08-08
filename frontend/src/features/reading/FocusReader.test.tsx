import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { chunkMarkdown } from "@/lib/chunk"
import { FocusReader } from "./FocusReader"

const source = [
  "# 光合作用",
  "## 光反应",
  "在类囊体薄膜上进行。产物是 ATP 和 NADPH。",
  "## 暗反应",
  "在叶绿体基质中进行。",
  "### 固定",
  "CO2 与 C5 结合。",
].join("\n")

const chunks = chunkMarkdown(source)

describe("focus reader", () => {
  it("offers no way to mark a stop read when nobody is keeping track", () => {
    // The control is only honest if something stores the answer. Without a
    // handler it would toggle, look answered, and forget.
    render(<FocusReader chunks={chunks} index={0} onIndexChange={vi.fn()} />)

    expect(screen.queryByRole("button", { name: /读完/ })).not.toBeInTheDocument()
  })

  it("marks the stop you just read", () => {
    const onToggleRead = vi.fn()
    render(
      <FocusReader chunks={chunks} index={0} onIndexChange={vi.fn()} onToggleRead={onToggleRead} />,
    )

    fireEvent.click(screen.getByRole("button", { name: /读完/ }))

    expect(onToggleRead).toHaveBeenCalledWith(chunks[0].id)
  })

  it("says a stop is already behind you", () => {
    render(
      <FocusReader
        chunks={chunks}
        index={0}
        onIndexChange={vi.fn()}
        onToggleRead={vi.fn()}
        readIds={new Set([chunks[0].id])}
      />,
    )

    expect(screen.getByRole("button", { name: /已读完/ })).toHaveAttribute("aria-pressed", "true")
  })

  it("keeps the mark with the stop, not with the position", () => {
    // Stop 1 read, stop 2 not. Arriving at 2 must not inherit 1's mark, or the
    // record would say you had read a page you never opened.
    render(
      <FocusReader
        chunks={chunks}
        index={1}
        onIndexChange={vi.fn()}
        onToggleRead={vi.fn()}
        readIds={new Set([chunks[0].id])}
      />,
    )

    expect(screen.getByRole("button", { name: /读完/ })).toHaveAttribute("aria-pressed", "false")
  })

  it("shows one stop at a time, so nothing else competes for attention", () => {
    render(<FocusReader chunks={chunks} index={0} onIndexChange={vi.fn()} />)

    expect(screen.getByText(/在类囊体薄膜上进行/)).toBeInTheDocument()
    expect(screen.queryByText(/在叶绿体基质中进行/)).not.toBeInTheDocument()
  })

  it("keeps the heading path in view, so the stop is readable out of context", () => {
    // 固定 is the third stop. Alone on screen it is just a sentence; the trail
    // above it is what says which part of the document you are standing in.
    render(<FocusReader chunks={chunks} index={2} onIndexChange={vi.fn()} />)

    expect(screen.getByText("光合作用 / 暗反应")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "固定" })).toBeInTheDocument()
  })

  it("says how far along the document you are", () => {
    render(<FocusReader chunks={chunks} index={1} onIndexChange={vi.fn()} />)

    expect(screen.getByText("2 / 3")).toBeInTheDocument()
  })

  it("moves to the next stop on an arrow key", () => {
    const onIndexChange = vi.fn()
    render(<FocusReader chunks={chunks} index={0} onIndexChange={onIndexChange} />)

    fireEvent.keyDown(screen.getByRole("region", { name: "正文" }), { key: "ArrowRight" })

    expect(onIndexChange).toHaveBeenCalledWith(1)
  })

  it("moves back on an arrow key", () => {
    const onIndexChange = vi.fn()
    render(<FocusReader chunks={chunks} index={2} onIndexChange={onIndexChange} />)

    fireEvent.keyDown(screen.getByRole("region", { name: "正文" }), { key: "ArrowLeft" })

    expect(onIndexChange).toHaveBeenCalledWith(1)
  })

  it("stops at the end rather than wrapping around to the start", () => {
    // Wrapping would quietly restart the document; at the end the honest
    // answer is that there is nothing further.
    const onIndexChange = vi.fn()
    render(<FocusReader chunks={chunks} index={2} onIndexChange={onIndexChange} />)

    fireEvent.keyDown(screen.getByRole("region", { name: "正文" }), { key: "ArrowRight" })

    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it("stops at the start rather than wrapping around to the end", () => {
    const onIndexChange = vi.fn()
    render(<FocusReader chunks={chunks} index={0} onIndexChange={onIndexChange} />)

    fireEvent.keyDown(screen.getByRole("region", { name: "正文" }), { key: "ArrowLeft" })

    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it("offers the same moves by click, for anyone not on a keyboard", () => {
    const onIndexChange = vi.fn()
    render(<FocusReader chunks={chunks} index={1} onIndexChange={onIndexChange} />)

    fireEvent.click(screen.getByRole("button", { name: /下一节/ }))

    expect(onIndexChange).toHaveBeenCalledWith(2)
  })

  it("disables the move that would run off the end", () => {
    render(<FocusReader chunks={chunks} index={2} onIndexChange={vi.fn()} />)

    expect(screen.getByRole("button", { name: /下一节/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /上一节/ })).toBeEnabled()
  })

  it("says so plainly when there is nothing to read yet", () => {
    render(<FocusReader chunks={[]} index={0} onIndexChange={vi.fn()} />)

    expect(screen.getByText(/选一个小节/)).toBeInTheDocument()
  })
})

describe("saying a stop did not land", () => {
  it("offers no way to flag a stop when nobody is keeping track", () => {
    render(<FocusReader chunks={chunks} index={0} onIndexChange={vi.fn()} />)

    expect(screen.queryByRole("button", { name: /没看懂/ })).not.toBeInTheDocument()
  })

  it("flags the stop you are standing on", () => {
    const onToggleStuck = vi.fn()
    render(
      <FocusReader chunks={chunks} index={1} onIndexChange={vi.fn()} onToggleStuck={onToggleStuck} />,
    )

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))

    expect(onToggleStuck).toHaveBeenCalledWith(chunks[1].id)
  })

  it("does not move you on, unlike finishing one", () => {
    // 读完 turns the page because you are done with it. Saying you did not
    // understand a stop is the opposite claim, and carrying you away from it
    // would be the last thing you wanted.
    const onIndexChange = vi.fn()
    render(
      <FocusReader
        chunks={chunks}
        index={0}
        onIndexChange={onIndexChange}
        onToggleStuck={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /没看懂/ }))

    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it("remembers a stop is flagged when you come back to it", () => {
    render(
      <FocusReader
        chunks={chunks}
        index={0}
        onIndexChange={vi.fn()}
        onToggleStuck={vi.fn()}
        stuckIds={new Set([chunks[0].id])}
      />,
    )

    expect(screen.getByRole("button", { name: /卡住了/ })).toHaveAttribute("aria-pressed", "true")
  })

  it("lets a stop be both finished and not understood", () => {
    // Reading the whole thing and still not having it is the common case, not
    // a contradiction the controls should rule out.
    render(
      <FocusReader
        chunks={chunks}
        index={0}
        onIndexChange={vi.fn()}
        onToggleRead={vi.fn()}
        onToggleStuck={vi.fn()}
        readIds={new Set([chunks[0].id])}
        stuckIds={new Set([chunks[0].id])}
      />,
    )

    expect(screen.getByRole("button", { name: /已读完/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: /卡住了/ })).toHaveAttribute("aria-pressed", "true")
  })
})
