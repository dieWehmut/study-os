import { describe, expect, it } from "vitest"

import { markdownToMindMap } from "./mindmap"

const source = [
  "# 光合作用",
  "## 光反应",
  "在类囊体薄膜上进行。",
  "- 产物是 ATP",
  "- 产物是 NADPH",
  "## 暗反应",
  "### 固定",
  "CO2 与 C5 结合。",
].join("\n")

describe("markdown to mindmap", () => {
  it("makes the document title the root", () => {
    const map = markdownToMindMap(source)

    const root = map.nodes.find((node) => !node.parent_id)
    expect(root?.label).toBe("光合作用")
    expect(map.title).toBe("光合作用")
  })

  it("hangs each section under the node it sits below in the document", () => {
    const map = markdownToMindMap(source)

    const byLabel = (label: string) => map.nodes.find((node) => node.label === label)
    const root = byLabel("光合作用")
    const dark = byLabel("暗反应")
    const fixing = byLabel("固定")
    // Assert the nodes exist before comparing: two undefined ids compare equal,
    // which would let an empty map pass as a correctly nested one.
    expect([root, dark, fixing].every(Boolean)).toBe(true)

    expect(dark?.parent_id).toBe(root?.id)
    expect(fixing?.parent_id).toBe(dark?.id)
  })

  it("carries list items in as points under their section", () => {
    const map = markdownToMindMap(source)

    const light = map.nodes.find((node) => node.label === "光反应")
    const point = map.nodes.find((node) => node.label === "产物是 ATP")
    expect(point).toBeDefined()
    expect(point?.parent_id).toBe(light?.id)
  })

  it("leaves prose out of the map", () => {
    // A mindmap that carries whole paragraphs is just the document again, in a
    // worse shape. Prose belongs to the reader; the map holds the skeleton.
    const map = markdownToMindMap(source)

    expect(map.nodes.some((node) => node.label.includes("类囊体"))).toBe(false)
  })

  it("keeps the prose as a note on the section it was written under", () => {
    // 0807:15 「每个节点可以是笔记、图片」. The outline parser already collects
    // these lines; dropping them here is what left the map a bare skeleton with
    // no way back to what the wiki actually said.
    const map = markdownToMindMap(source)

    expect(map.nodes.find((node) => node.label === "光反应")?.note).toBe("在类囊体薄膜上进行。")
  })

  it("joins a section's several prose lines into one note", () => {
    const map = markdownToMindMap(["# 生物", "## 细胞", "第一行。", "第二行。"].join("\n"))

    expect(map.nodes.find((node) => node.label === "细胞")?.note).toBe("第一行。\n第二行。")
  })

  it("leaves the note off a section that has no prose", () => {
    // An empty string would make every node look annotated, and the drawing
    // would then have to tell "" apart from "absent" to know whether to mark it.
    const map = markdownToMindMap(source)

    expect(map.nodes.find((node) => node.label === "暗反应")).not.toHaveProperty("note")
  })

  it("says what kind each node is, so the drawing can tell them apart", () => {
    const map = markdownToMindMap(source)

    expect(map.nodes.find((node) => node.label === "光合作用")?.node_type).toBe("root")
    expect(map.nodes.find((node) => node.label === "光反应")?.node_type).toBe("heading")
    expect(map.nodes.find((node) => node.label === "产物是 ATP")?.node_type).toBe("item")
  })

  it("keeps two identically titled sections apart", () => {
    // Ids derived from the title would collide here and silently merge two
    // different parts of the document into one branch.
    const map = markdownToMindMap(["# 生物", "## 例题", "### A", "## 例题", "### B"].join("\n"))

    const examples = map.nodes.filter((node) => node.label === "例题")
    expect(examples).toHaveLength(2)
    expect(examples[0].id).not.toBe(examples[1].id)
    expect(map.nodes.find((node) => node.label === "A")?.parent_id).toBe(examples[0].id)
    expect(map.nodes.find((node) => node.label === "B")?.parent_id).toBe(examples[1].id)
  })

  it("produces the same map every run", () => {
    // The whole reason no model arranges this tree: a preview you cannot
    // recognise on second opening is not a preview.
    expect(markdownToMindMap(source)).toEqual(markdownToMindMap(source))
  })

  it("has nothing to draw for an empty document", () => {
    expect(markdownToMindMap("   ").nodes).toHaveLength(0)
  })

  it("uses a given title when the document has none of its own", () => {
    const map = markdownToMindMap("## 光反应\n正文", { title: "未命名" })

    const root = map.nodes.find((node) => !node.parent_id)
    expect(root?.label).toBe("未命名")
    expect(map.nodes.find((node) => node.label === "光反应")?.parent_id).toBe(root?.id)
  })

  it("still names the root when nobody supplied a title", () => {
    // Pasting a section out of a longer wiki is normal, and it arrives with no
    // level-1 heading. An unlabelled box at the centre of the map helps nobody.
    const map = markdownToMindMap("## 光反应\n正文")

    expect(map.nodes.find((node) => !node.parent_id)?.label).toBe("未命名")
  })

  it("does not repeat the given title as the map's first branch", () => {
    // Every wiki entry in the library is written *about* a term, so it opens
    // "## <term>". Handed that same term as the title, the map used to root at
    // it and then hang a single child called the same thing -- so the real
    // shape of every page began with a duplicate of its own name.
    const map = markdownToMindMap("## abandon\n\n放弃。\n\n## 搭配\n- abandon ship", {
      title: "abandon",
    })

    expect(map.nodes.filter((node) => node.label === "abandon")).toHaveLength(1)
  })
})
