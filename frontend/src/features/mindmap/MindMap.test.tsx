import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MindMap } from "./MindMap"
import { toMermaid } from "@/lib/mermaid"

const data = {
  title: "运动学",
  nodes: [
    { id: "n0", label: "运动学", node_type: "root" },
    { id: "n1", label: "速度", parent_id: "n0", node_type: "heading" },
    { id: "n3", label: "瞬时速度", parent_id: "n1", node_type: "heading" },
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

  it("draws a section differently from a point inside it", () => {
    // Both kinds come out of the markdown converter. Drawn identically, a
    // chapter and a single bullet look like peers, which erases the hierarchy
    // the map exists to show.
    render(<MindMap data={data} />)

    const section = screen.getByRole("treeitem", { name: "速度" }).querySelector("rect")
    const point = screen.getByRole("treeitem", { name: "平均速度" }).querySelector("rect")

    expect(section).toHaveAttribute("fill")
    expect(point).toHaveAttribute("fill")
    expect(point?.getAttribute("fill")).not.toBe(section?.getAttribute("fill"))
  })

  it("keeps the trunk distinct from the sections hanging off it", () => {
    render(<MindMap data={data} />)

    const root = screen.getByRole("treeitem", { name: "运动学" }).querySelector("rect")
    const section = screen.getByRole("treeitem", { name: "速度" }).querySelector("rect")

    expect(root).toHaveAttribute("fill")
    expect(section?.getAttribute("fill")).not.toBe(root?.getAttribute("fill"))
  })

  it("reports how deep each node sits, for anyone reading it aloud", () => {
    render(<MindMap data={data} />)

    expect(screen.getByRole("treeitem", { name: "运动学" })).toHaveAttribute("aria-level", "1")
    expect(screen.getByRole("treeitem", { name: "瞬时速度" })).toHaveAttribute("aria-level", "3")
  })

  it("grows rightward, one column per level", () => {
    // A mindmap reads left to right: the trunk on the left, detail extending
    // away from it. Stacked downward instead, a deep branch runs off the
    // bottom of a screen that is wider than it is tall.
    render(<MindMap data={data} />)

    const x = (name: string) =>
      Number(screen.getByRole("treeitem", { name }).querySelector("rect")!.getAttribute("x"))

    expect(x("速度")).toBeGreaterThan(x("运动学"))
    expect(x("瞬时速度")).toBeGreaterThan(x("速度"))
    // Same depth, same column -- otherwise depth is not readable from position.
    expect(x("加速度")).toBe(x("速度"))
  })

  it("sits a parent level with the middle of its own children", () => {
    // Placing nodes by their index across the whole level lets a child drift
    // far from its parent, leaving a long diagonal edge that reads as a link
    // between unrelated branches.
    render(<MindMap data={data} />)

    const y = (name: string) =>
      Number(screen.getByRole("treeitem", { name }).querySelector("rect")!.getAttribute("y"))

    const children = [y("瞬时速度"), y("平均速度")]
    expect(y("速度")).toBeGreaterThan(Math.min(...children))
    expect(y("速度")).toBeLessThan(Math.max(...children))
  })

  it("keeps siblings from landing on top of each other", () => {
    render(<MindMap data={data} />)

    const y = (name: string) =>
      Number(screen.getByRole("treeitem", { name }).querySelector("rect")!.getAttribute("y"))

    expect(Math.abs(y("瞬时速度") - y("平均速度"))).toBeGreaterThanOrEqual(40)
    expect(Math.abs(y("速度") - y("加速度"))).toBeGreaterThanOrEqual(40)
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
