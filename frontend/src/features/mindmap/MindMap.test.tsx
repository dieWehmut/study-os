import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MindMap } from "./MindMap"
import { toMermaid } from "@/lib/mermaid"

/**
 * The line a node's label sits on.
 *
 * Geometry used to be read off each node's box. There are no boxes now, so the
 * underline is what carries a node's position and width -- and it is also what
 * the edges join, which is why it is worth asserting on directly.
 */
function underline(name: string): SVGLineElement {
  return screen.getByRole("treeitem", { name }).querySelector("line")!
}

function left(name: string): number {
  return Number(underline(name).getAttribute("x1"))
}

function right(name: string): number {
  return Number(underline(name).getAttribute("x2"))
}

function baseline(name: string): number {
  return Number(underline(name).getAttribute("y1"))
}

const data = {
  title: "运动学",
  nodes: [
    { id: "n0", label: "运动学", node_type: "root" },
    { id: "n1", label: "速度", parent_id: "n0", node_type: "heading" },
    {
      id: "n3",
      label: "瞬时速度",
      parent_id: "n1",
      node_type: "heading",
      note: "某一时刻或某一位置的速度，是平均速度在时间趋于零时的极限。",
    },
    { id: "n5", label: "定义", parent_id: "n3", node_type: "item" },
    { id: "n4", label: "平均速度", parent_id: "n1", node_type: "item" },
    { id: "n2", label: "加速度", parent_id: "n0", node_type: "conclusion" },
  ],
}

describe("MindMap", () => {
  it("draws the map as a navigable tree", () => {
    render(<MindMap data={data} />)

    expect(screen.getByRole("tree", { name: "导图：运动学" })).toBeInTheDocument()
    expect(screen.getByRole("treeitem", { name: "速度" })).toBeInTheDocument()
  })

  it("shows every branch until one is folded", () => {
    render(<MindMap data={data} />)

    expect(screen.getAllByRole("treeitem")).toHaveLength(6)
  })

  it("folds a whole subtree away, not just the children one level down", () => {
    // Hiding only the direct children would leave grandchildren floating with
    // no visible parent, which reads as a second map rather than a fold.
    render(<MindMap data={data} />)

    fireEvent.click(screen.getByRole("treeitem", { name: "速度" }))

    expect(screen.queryByRole("treeitem", { name: "瞬时速度" })).not.toBeInTheDocument()
    expect(screen.queryByRole("treeitem", { name: "定义" })).not.toBeInTheDocument()
    expect(screen.queryByRole("treeitem", { name: "平均速度" })).not.toBeInTheDocument()
  })

  it("keeps the folded branch itself on screen", () => {
    render(<MindMap data={data} />)

    fireEvent.click(screen.getByRole("treeitem", { name: "速度" }))

    expect(screen.getByRole("treeitem", { name: "速度" })).toHaveAttribute("aria-expanded", "false")
  })

  it("says how much is folded away, so nothing goes missing silently", () => {
    render(<MindMap data={data} />)

    fireEvent.click(screen.getByRole("treeitem", { name: "速度" }))

    expect(screen.getByText("+3")).toBeInTheDocument()
  })

  it("leaves sibling branches alone", () => {
    render(<MindMap data={data} />)

    fireEvent.click(screen.getByRole("treeitem", { name: "速度" }))

    expect(screen.getByRole("treeitem", { name: "加速度" })).toBeInTheDocument()
  })

  it("brings the branch back on a second click", () => {
    render(<MindMap data={data} />)

    const branch = screen.getByRole("treeitem", { name: "速度" })
    fireEvent.click(branch)
    fireEvent.click(screen.getByRole("treeitem", { name: "速度" }))

    expect(screen.getByRole("treeitem", { name: "定义" })).toBeInTheDocument()
    expect(screen.getByRole("treeitem", { name: "速度" })).toHaveAttribute("aria-expanded", "true")
  })

  it("folds from the keyboard too", () => {
    render(<MindMap data={data} />)

    fireEvent.keyDown(screen.getByRole("treeitem", { name: "速度" }), { key: "Enter" })

    expect(screen.queryByRole("treeitem", { name: "平均速度" })).not.toBeInTheDocument()
  })

  it("offers no fold on a node with nothing under it", () => {
    render(<MindMap data={data} />)

    expect(screen.getByRole("treeitem", { name: "加速度" })).not.toHaveAttribute("aria-expanded")
  })

  it("paints no boxes", () => {
    // 「节点样式别是一个一个像 obsidian canvas 那样的一个一个方框就行」(0807:16).
    // A box per node is a container you read past before reaching the label, and
    // forty of them make the map the grid it was meant to replace.
    //
    // Rectangles still exist -- each node needs one, unpainted, or the click
    // target becomes the glyphs themselves and the gaps between characters stop
    // belonging to the node. So the check is that none of them paints anything,
    // which is the requirement; "no rect at all" would be a stricter rule than
    // was asked for, bought by making the map worse to click.
    render(<MindMap data={data} />)

    const boxes = [...screen.getByRole("tree").querySelectorAll("rect")]
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) {
      expect(box.getAttribute("fill")).toBe("transparent")
      expect(box.getAttribute("stroke")).toBe("none")
    }
  })

  it("draws a section differently from a point inside it", () => {
    // Both kinds come out of the markdown converter. Drawn identically, a
    // chapter and a single bullet look like peers, which erases the hierarchy
    // the map exists to show. Weight, not colour -- 0807:16 says colour does
    // not matter, and a distinction only colour carries is no distinction to
    // anyone who cannot see it.
    render(<MindMap data={data} />)

    const section = underline("速度").getAttribute("stroke-width")
    const point = underline("平均速度").getAttribute("stroke-width")

    expect(section).toBeTruthy()
    expect(point).not.toBe(section)
  })

  it("keeps the trunk distinct from the sections hanging off it", () => {
    render(<MindMap data={data} />)

    expect(underline("速度").getAttribute("stroke-width")).not.toBe(
      underline("运动学").getAttribute("stroke-width"),
    )
  })

  it("reports how deep each node sits, for anyone reading it aloud", () => {
    render(<MindMap data={data} />)

    expect(screen.getByRole("treeitem", { name: "运动学" })).toHaveAttribute("aria-level", "1")
    expect(screen.getByRole("treeitem", { name: "瞬时速度" })).toHaveAttribute("aria-level", "3")
  })

  it("stops a foldable node's line at its label, not at its reserved space", () => {
    // A foldable node claims room for a caret and a "+N" it is not currently
    // showing. Drawing that reservation as line leaves a blank tail in the
    // node's own colour running out past the label and into the connector, and
    // parent line, connector and child line then read as one unbroken stroke
    // with no visible node boundary. Found by looking at the rendered map --
    // every geometry test here passed while it was wrong.
    render(<MindMap data={data} />)

    const foldable = right("速度") - left("速度")
    const leaf = right("平均速度") - left("平均速度")

    // 「速度」 is two characters, 「平均速度」 is four. If the reservation were
    // being drawn, the shorter foldable label would own the longer line.
    expect(foldable).toBeLessThan(leaf)
  })

  it("grows rightward, one column per level", () => {
    // A mindmap reads left to right: the trunk on the left, detail extending
    // away from it. Stacked downward instead, a deep branch runs off the
    // bottom of a screen that is wider than it is tall.
    render(<MindMap data={data} />)

    expect(left("速度")).toBeGreaterThan(left("运动学"))
    expect(left("瞬时速度")).toBeGreaterThan(left("速度"))
    // Same depth, same column -- otherwise depth is not readable from position.
    expect(left("加速度")).toBe(left("速度"))
  })

  it("sits a parent level with the middle of its own children", () => {
    // Placing nodes by their index across the whole level lets a child drift
    // far from its parent, leaving a long diagonal edge that reads as a link
    // between unrelated branches.
    render(<MindMap data={data} />)

    const children = [baseline("瞬时速度"), baseline("平均速度")]
    expect(baseline("速度")).toBeGreaterThan(Math.min(...children))
    expect(baseline("速度")).toBeLessThan(Math.max(...children))
  })

  it("keeps siblings from landing on top of each other", () => {
    render(<MindMap data={data} />)

    expect(Math.abs(baseline("瞬时速度") - baseline("平均速度"))).toBeGreaterThanOrEqual(40)
    expect(Math.abs(baseline("速度") - baseline("加速度"))).toBeGreaterThanOrEqual(40)
  })

  it("widens a node to fit its heading rather than cutting the heading", () => {
    // A truncated heading is the failure the map exists to avoid: you cannot
    // preview a structure whose labels stop mid-phrase, and "副热带高气压带的…"
    // tells you less than the paragraph it was meant to stand in for.
    render(
      <MindMap
        data={{
          title: "气压带",
          nodes: [
            { id: "r", label: "气压带", node_type: "root" },
            { id: "a", label: "副热带高气压带的形成与季节移动规律及其影响", parent_id: "r", node_type: "heading" },
          ],
        }}
      />,
    )

    expect(screen.getByText("副热带高气压带的形成与季节移动规律及其影响")).toBeInTheDocument()
  })

  it("gives a long node more width than a short one", () => {
    render(
      <MindMap
        data={{
          title: "对比",
          nodes: [
            { id: "r", label: "对比", node_type: "root" },
            { id: "a", label: "短", parent_id: "r", node_type: "item" },
            { id: "b", label: "副热带高气压带的形成与季节移动规律及其影响", parent_id: "r", node_type: "item" },
          ],
        }}
      />,
    )

    const width = (name: string) => right(name) - left(name)

    expect(width("副热带高气压带的形成与季节移动规律及其影响")).toBeGreaterThan(width("短"))
  })

  it("keeps a wide node from overlapping the column after it", () => {
    // Columns no longer share one width, so a column's position has to come
    // from the widest node before it. A fixed stride would let a long heading
    // run straight through its own children.
    render(
      <MindMap
        data={{
          title: "根",
          nodes: [
            { id: "r", label: "根", node_type: "root" },
            { id: "a", label: "副热带高气压带的形成与季节移动规律及其影响", parent_id: "r", node_type: "heading" },
            { id: "b", label: "子", parent_id: "a", node_type: "item" },
          ],
        }}
      />,
    )

    expect(left("子")).toBeGreaterThan(right("副热带高气压带的形成与季节移动规律及其影响"))
  })

  it("shows the note a node carries, once you open it", () => {
    // 0807:15 「每个节点可以是笔记、图片」. The label is a heading lifted out of
    // the wiki; the sentence it was lifted from is what tells you whether you
    // still understand it. Reaching that should not mean leaving the map.
    render(<MindMap data={data} />)

    fireEvent.click(screen.getByRole("button", { name: "展开笔记：瞬时速度" }))

    expect(screen.getByText(/某一时刻或某一位置的速度/)).toBeInTheDocument()
  })

  it("keeps the note out of the way until asked", () => {
    // Every note open at once is the wall of prose the map exists to replace.
    render(<MindMap data={data} />)

    expect(screen.queryByText(/某一时刻或某一位置的速度/)).not.toBeInTheDocument()
  })

  it("offers nothing to open on a node with no note", () => {
    render(<MindMap data={data} />)

    expect(screen.queryByRole("button", { name: "展开笔记：平均速度" })).not.toBeInTheDocument()
  })

  it("opening a note does not fold the branch under it", () => {
    // The note sits inside the node's own click target, which already toggles
    // the fold. Without stopping the event, reading a note collapses the branch
    // you were reading it in.
    render(<MindMap data={data} />)

    fireEvent.click(screen.getByRole("button", { name: "展开笔记：瞬时速度" }))

    expect(screen.getByRole("treeitem", { name: "定义" })).toBeInTheDocument()
  })

  it("exports mermaid text with edges", () => {
    const mermaid = toMermaid({
      title: "运动学",
      nodes: [
        { id: "n0", label: "运动学" },
        { id: "n1", label: "速度", parent_id: "n0" },
      ],
    })
    expect(mermaid).toContain("graph TD")
    expect(mermaid).toContain("n0 --> n1")
    expect(mermaid).toContain('n1["速度"]')
  })
})
