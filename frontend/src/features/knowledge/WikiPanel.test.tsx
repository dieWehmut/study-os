import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WikiPanel } from "./WikiPanel"
import type { KnowledgeItem } from "@/api/types"

const mocks = vi.hoisted(() => ({
  listRelatedKnowledge: vi.fn(),
  scheduleKnowledge: vi.fn(),
  saveKnowledgeWiki: vi.fn(),
  updateKnowledgeTag: vi.fn(),
}))

vi.mock("@/api/knowledge", () => mocks)
vi.mock("@/api/chat", () => ({ updateKnowledgeTag: mocks.updateKnowledgeTag }))

// Line 0 is the first heading, line 4 the second. The wiki opens at `##`
// because it was written *about* the term, which is why the map is titled from
// `term` and its root reports no line of its own.
const markdown = "## 光反应\n\n发生在类囊体薄膜。\n\n## 暗反应\n"

const item: KnowledgeItem = {
  id: "k1",
  item_type: "concept",
  term: "光合作用",
  concise_definition: "光能转化为化学能",
  detailed_markdown: markdown,
}

/**
 * The panel plus the one thing its caller does with `onUpdated`.
 *
 * A rename is only real if it survives the redraw: the map holds no state, so
 * the new title has to come back through the markdown or it is not there at
 * all. Asserting on the mock call alone would pass even if the wiki never
 * changed.
 */
function Harness({ start }: { start: KnowledgeItem }) {
  const [current, setCurrent] = useState(start)
  return <WikiPanel item={current} onUpdated={setCurrent} />
}

function openMap() {
  fireEvent.click(screen.getByRole("tab", { name: "导图" }))
}

function rename(from: string, to: string) {
  fireEvent.click(screen.getByRole("button", { name: `重命名：${from}` }))
  const field = screen.getByRole("textbox", { name: "节点标题" })
  fireEvent.change(field, { target: { value: to } })
  fireEvent.keyDown(field, { key: "Enter" })
}

describe("WikiPanel node renaming", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listRelatedKnowledge.mockResolvedValue({ items: [], groups: [] })
  })

  it("writes a renamed node back into the wiki it was drawn from", async () => {
    mocks.saveKnowledgeWiki.mockImplementation((id: string, next: string) =>
      Promise.resolve({ ...item, id, detailed_markdown: next }),
    )
    render(<Harness start={item} />)
    openMap()

    rename("光反应", "光反应阶段")

    // The whole document goes back, with one line changed and the rest
    // byte-equal -- the blank lines and the prose between the two headings are
    // what a regenerated document would have laundered.
    await waitFor(() =>
      expect(mocks.saveKnowledgeWiki).toHaveBeenCalledWith(
        "k1",
        "## 光反应阶段\n\n发生在类囊体薄膜。\n\n## 暗反应\n",
      ),
    )
    // And it survives the redraw, which is the only proof that it landed in the
    // source rather than in some state the next parse would throw away.
    expect(await screen.findByRole("treeitem", { name: "光反应阶段" })).toBeInTheDocument()
  })

  it("keeps the old title and says so when the save fails", async () => {
    // The map is redrawn from the item it was handed, so a failed write leaves
    // the old title on screen by itself. Without a word from the panel that
    // reads as "the rename silently did nothing".
    mocks.saveKnowledgeWiki.mockRejectedValue(new Error("offline"))
    render(<Harness start={item} />)
    openMap()

    rename("光反应", "光反应阶段")

    expect(await screen.findByText("改名失败，请重试")).toBeInTheDocument()
    expect(screen.getByRole("treeitem", { name: "光反应" })).toBeInTheDocument()
  })

  it("refuses a title the markdown cannot carry, without touching the wiki", async () => {
    // Clearing the field and pressing Enter is one keystroke away at all times.
    // An empty heading is not a heading: the node and everything nested under
    // it would drop out of the map on the next parse.
    render(<Harness start={item} />)
    openMap()

    rename("光反应", "   ")

    expect(await screen.findByText("这个标题存不下来，换一个")).toBeInTheDocument()
    expect(mocks.saveKnowledgeWiki).not.toHaveBeenCalled()
  })

  it("offers no rename on the root, which the wiki never named", async () => {
    // The map is titled from the item's term because the wiki opens at "##".
    // That title is on no line, so renaming it would write over line 0 -- which
    // is 光反应, a different node entirely.
    render(<Harness start={item} />)
    openMap()

    expect(screen.queryByRole("button", { name: "重命名：光合作用" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重命名：暗反应" })).toBeInTheDocument()
  })
})
