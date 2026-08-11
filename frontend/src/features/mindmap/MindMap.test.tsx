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

/**
 * The top of a node's row -- its click target, which is the only part of a node
 * with any area.
 *
 * Overlap is a claim about rows, not about ink: a panel that stops just above a
 * label still covers the row that label was given.
 */
function top(name: string): number {
  return Number(screen.getByRole("treeitem", { name }).querySelector("rect")!.getAttribute("y"))
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

// The same tree, but as it comes out of a document: every node answers "which
// line am I on". The root keeps no line, exactly like the root of a wiki
// entry's map, which is titled from the item's term rather than read out of the
// wiki.
const editable = {
  title: "运动学",
  nodes: [
    { id: "n0", label: "运动学", node_type: "root" },
    { id: "n1", label: "速度", parent_id: "n0", node_type: "heading", line: 3 },
    { id: "n3", label: "瞬时速度", parent_id: "n1", node_type: "heading", line: 4 },
    { id: "n5", label: "定义", parent_id: "n3", node_type: "item", line: 5 },
    { id: "n4", label: "平均速度", parent_id: "n1", node_type: "item", line: 6 },
    { id: "n2", label: "加速度", parent_id: "n0", node_type: "conclusion", line: 7 },
  ],
}

// The same shape the markdown table parser hands out: siblings packed one row
// apart, each carrying one note line per column. Copied from the live 近义辨析
// table in the abandon wiki, where opening one row's note covered the next row
// outright -- the defect the note-overlap tests exist for.
const table = {
  title: "abandon",
  nodes: [
    { id: "n0", label: "abandon", node_type: "root" },
    { id: "n1", label: "近义辨析", parent_id: "n0", node_type: "heading" },
    { id: "n2", label: "desert", parent_id: "n1", node_type: "item", note: "侧重：违背责任而擅离\n语体：中性\n例：desert one's post" },
    { id: "n3", label: "give up", parent_id: "n1", node_type: "item", note: "侧重：停止尝试\n例：give up smoking" },
    { id: "n4", label: "abandon（舍去）", parent_id: "n1", node_type: "item" },
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

  it("gives a re-opened branch back exactly as it was left", () => {
    // 0807:13 calls this out as the one usage detail worth naming: folding a
    // middle level and opening it again must not disturb what the reader had
    // already folded underneath it. Reading a fold as "hide my descendants"
    // would quietly reset them, so the reader loses their place every time
    // they collapse an ancestor to see around it.
    render(<MindMap data={data} />)

    fireEvent.click(screen.getByRole("treeitem", { name: "瞬时速度" }))
    fireEvent.click(screen.getByRole("treeitem", { name: "速度" }))
    fireEvent.click(screen.getByRole("treeitem", { name: "速度" }))

    expect(screen.getByRole("treeitem", { name: "瞬时速度" })).toBeInTheDocument()
    expect(screen.queryByRole("treeitem", { name: "定义" })).not.toBeInTheDocument()
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

  it("shows the picture a node carries, once you open it", () => {
    // The other half of 0807:15 「每个节点可以是笔记、图片」. A diagram is the thing
    // a 图文笔记 is for: the prose under 光反应 describes a membrane, and the
    // picture of it is what makes the description land.
    render(
      <MindMap
        data={{
          title: "光合作用",
          nodes: [
            { id: "r", label: "光合作用", node_type: "root" },
            {
              id: "a",
              label: "光反应",
              parent_id: "r",
              node_type: "heading",
              note: "发生在类囊体薄膜。",
              image: "/img/light.png",
              image_alt: "示意图",
            },
          ],
        }}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "展开笔记：光反应" }))

    const picture = screen.getByRole("img", { name: "示意图" })
    expect(picture).toHaveAttribute("href", "/img/light.png")
  })

  it("offers a picture-only node something to open", () => {
    // The parser omits `note` rather than emptying it when the body was nothing
    // but an image (mindmap.ts). Gating the marker on the note alone therefore
    // hides the picture completely -- the node draws as a bare label with no
    // hint that anything is under it.
    render(
      <MindMap
        data={{
          title: "甲",
          nodes: [
            { id: "r", label: "甲", node_type: "root" },
            { id: "a", label: "乙", parent_id: "r", node_type: "item", image: "/only.png" },
          ],
        }}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "展开图片：乙" }))

    expect(screen.getByRole("img", { name: "乙" })).toHaveAttribute("href", "/only.png")
  })

  it("keeps the picture out of the way until asked", () => {
    render(
      <MindMap
        data={{
          title: "甲",
          nodes: [
            { id: "r", label: "甲", node_type: "root" },
            { id: "a", label: "乙", parent_id: "r", node_type: "item", image: "/only.png" },
          ],
        }}
      />,
    )

    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it("makes room for an opened panel instead of clipping it", () => {
    // `layout` sizes the canvas from the closed tree, because a panel is state
    // that only exists after a click. Left at that, the panel is drawn 264px
    // wide hanging off a node near the right edge, and everything past the
    // canvas is cropped by the SVG viewport -- on a real map the picture was
    // more than half gone while every assertion about the DOM still passed.
    // This is the fourth defect in this component that lives in geometry
    // rather than in the tree, so it gets a test that measures.
    render(<MindMap data={data} />)
    const svg = screen.getByRole("tree", { name: "导图：运动学" })
    const closed = Number(svg.dataset.width)

    fireEvent.click(screen.getByRole("button", { name: "展开笔记：瞬时速度" }))

    const panel = svg.querySelector("[role='note'] rect")!
    const right = Number(panel.getAttribute("x")) + Number(panel.getAttribute("width"))
    expect(Number(svg.dataset.width)).toBeGreaterThanOrEqual(right)

    // And it gives the room back, so the map does not stay stretched around a
    // panel the reader has already dismissed.
    fireEvent.click(screen.getByRole("button", { name: "收起笔记：瞬时速度" }))
    expect(Number(svg.dataset.width)).toBe(closed)
  })

  it("makes room below for a panel opened on the last row", () => {
    // The same defect on the other axis: a note hanging off the bottom row has
    // its whole height below the canvas, which is where a picture's 148px sit.
    render(<MindMap data={data} />)
    const svg = screen.getByRole("tree", { name: "导图：运动学" })

    fireEvent.click(screen.getByRole("button", { name: "展开笔记：瞬时速度" }))

    const panel = svg.querySelector("[role='note'] rect")!
    const bottom = Number(panel.getAttribute("y")) + Number(panel.getAttribute("height"))
    expect(Number(svg.dataset.height)).toBeGreaterThanOrEqual(bottom)
  })

  it("pushes the row below an opened note down instead of covering it", () => {
    // The panel is drawn last so it sits over the branches, which is right for a
    // curve and wrong for a label: the sibling one row down was simply hidden
    // underneath it. Rare while every node was a heading, routine now that a
    // markdown table turns each row into a tightly packed sibling carrying a
    // note per column -- opening 「desert」 covered 「give up」 outright on the
    // real 近义辨析 table this fixture is copied from. Reserving the room in the
    // layout is the only fix that holds whatever height the note turns out to be.
    render(<MindMap data={table} />)
    const svg = screen.getByRole("tree", { name: "导图：abandon" })
    const before = top("give up")

    fireEvent.click(screen.getByRole("button", { name: "展开笔记：desert" }))

    const panel = svg.querySelector("[role='note'] rect")!
    const bottom = Number(panel.getAttribute("y")) + Number(panel.getAttribute("height"))
    expect(top("give up")).toBeGreaterThanOrEqual(bottom)

    // And the room comes back, so a map read through note by note does not
    // ratchet itself taller with every click.
    fireEvent.click(screen.getByRole("button", { name: "收起笔记：desert" }))
    expect(top("give up")).toBe(before)
  })

  it("keeps a parent level with its children after a note pushes them apart", () => {
    // Rows are what get pushed, and a parent's row is the midpoint of its own
    // first and last child. Push the children without re-deriving that midpoint
    // and the branch leaves its parent at an angle -- the one thing the
    // midpoint rule exists to prevent. Shifting every row below the note by a
    // flat amount would land 「近义辨析」 here at 200 rather than 158.
    render(<MindMap data={table} />)

    fireEvent.click(screen.getByRole("button", { name: "展开笔记：desert" }))

    expect(top("近义辨析")).toBe((top("desert") + top("abandon（舍去）")) / 2)
  })

  it("scales to its container when asked to fit", () => {
    // A map is sized in pixels from its own content, and on /integrate it gets a
    // full-width card, so overflowing into a scroll is the right answer there.
    // Hung off a wiki (ROADMAP §5.4) it lives in a ~300px column instead, where
    // the same fixed width clips every deep branch off the right edge -- a real
    // 22-node map of a word wiki rendered as a 1600px vertical ribbon with two
    // thirds of it unreachable.
    //
    // A viewBox is what lets the drawing keep its own coordinates while the
    // element takes the width it is given. Opt-in, so the scrolling call sites
    // keep the behaviour they were designed around.
    render(<MindMap data={data} fit />)

    const svg = screen.getByRole("tree", { name: "导图：运动学" })

    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${svg.dataset.width} ${svg.dataset.height}`)
    expect(svg.getAttribute("width")).toBe("100%")
  })

  it("keeps its intrinsic size when not fitting", () => {
    render(<MindMap data={data} />)

    const svg = screen.getByRole("tree", { name: "导图：运动学" })

    expect(svg.getAttribute("width")).toBe(svg.dataset.width)
  })

  it("offers a rename on a node that came from a source line", () => {
    // 0807:13 「可轻易编辑」, the last unmet requirement in ROADMAP §5.2.
    //
    // Its own affordance rather than a double-click: single click already folds,
    // so a double-click would fold and unfold on the way to the editor. A third
    // marker beside ≡ and ▣ also inherits their keyboard reachability.
    render(<MindMap data={editable} onRename={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: "重命名：速度" }))

    expect(screen.getByRole("textbox", { name: "节点标题" })).toHaveValue("速度")
  })

  it("hands the edited title back with the line to write it on", () => {
    const renames: Array<[number, string]> = []
    render(<MindMap data={editable} onRename={(line, title) => renames.push([line, title])} />)

    fireEvent.click(screen.getByRole("button", { name: "重命名：速度" }))
    fireEvent.change(screen.getByRole("textbox", { name: "节点标题" }), {
      target: { value: "瞬时速率" },
    })
    fireEvent.keyDown(screen.getByRole("textbox", { name: "节点标题" }), { key: "Enter" })

    // The line, not the node id: the map is re-derived from markdown on every
    // draw, so ids are positional and mean nothing to whoever holds the source.
    expect(renames).toEqual([[3, "瞬时速率"]])
  })

  it("abandons an edit on escape", () => {
    const renames: string[] = []
    render(<MindMap data={editable} onRename={(_, title) => renames.push(title)} />)

    fireEvent.click(screen.getByRole("button", { name: "重命名：速度" }))
    fireEvent.change(screen.getByRole("textbox", { name: "节点标题" }), { target: { value: "改坏了" } })
    fireEvent.keyDown(screen.getByRole("textbox", { name: "节点标题" }), { key: "Escape" })

    expect(renames).toEqual([])
    expect(screen.queryByRole("textbox", { name: "节点标题" })).not.toBeInTheDocument()
  })

  it("offers no rename on a node the document never named", () => {
    // The root of a wiki entry's map is titled from the item's term, so it has
    // no line -- renaming it would write over whatever sits there.
    render(<MindMap data={editable} onRename={() => {}} />)

    expect(screen.queryByRole("button", { name: "重命名：运动学" })).not.toBeInTheDocument()
  })

  it("offers no rename when nothing can receive one", () => {
    // /integrate draws maps that came over the wire, with no local markdown to
    // write back to. A pencil there would be a control that silently does
    // nothing.
    render(<MindMap data={editable} />)

    expect(screen.queryByRole("button", { name: "重命名：速度" })).not.toBeInTheDocument()
  })

  it("does not fold the branch it is renaming", () => {
    // Same trap the note marker had: the pencil sits inside the node's own click
    // target, which toggles the fold.
    render(<MindMap data={editable} onRename={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: "重命名：速度" }))

    expect(screen.getByRole("treeitem", { name: "速度" })).toHaveAttribute("aria-expanded", "true")
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
