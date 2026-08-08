import { describe, expect, it } from "vitest"

import { flattenOutline, parseOutline } from "./outline"

describe("markdown outline parser", () => {
  it("nests sections by heading level", () => {
    const root = parseOutline(["# 光合作用", "## 光反应", "### 场所", "## 暗反应"].join("\n"))

    expect(root.title).toBe("光合作用")
    expect(root.children.map((child) => child.title)).toEqual(["光反应", "暗反应"])
    expect(root.children[0].children.map((child) => child.title)).toEqual(["场所"])
  })

  it("attaches prose to the section that introduced it", () => {
    const root = parseOutline(["# 标题", "## 光反应", "发生在类囊体薄膜上。", "产物是 ATP。"].join("\n"))

    expect(root.children[0].body).toEqual(["发生在类囊体薄膜上。", "产物是 ATP。"])
    expect(root.body).toEqual([])
  })

  it("keeps text written before the first heading", () => {
    // A pasted 教辅 excerpt often opens with a paragraph and no title at all.
    // Dropping it would silently lose the first thing the learner sees.
    const root = parseOutline("这段话没有标题。\n\n## 小节", { title: "未命名" })

    expect(root.title).toBe("未命名")
    expect(root.body).toEqual(["这段话没有标题。"])
    expect(root.children.map((child) => child.title)).toEqual(["小节"])
  })

  it("turns list items into children and nests them by indentation", () => {
    const root = parseOutline(["# 标题", "## 条件", "- 光照", "  - 强度", "- 温度"].join("\n"))

    const conditions = root.children[0]
    expect(conditions.children.map((child) => child.title)).toEqual(["光照", "温度"])
    expect(conditions.children[0].children.map((child) => child.title)).toEqual(["强度"])
  })

  it("does not lose a section when the author skips a heading level", () => {
    // Hand-written 教辅 markdown jumps h1 -> h3 constantly. Treating the gap as
    // an error would drop the section; re-parenting to the nearest open
    // ancestor keeps every heading reachable.
    const root = parseOutline(["# 标题", "### 深层小节", "## 正常小节"].join("\n"))

    expect(root.children.map((child) => child.title)).toEqual(["深层小节", "正常小节"])
  })

  it("gives every node a stable id derived from its position", () => {
    const source = ["# 标题", "## 甲", "## 乙"].join("\n")

    expect(flattenOutline(parseOutline(source)).map((node) => node.id)).toEqual(
      flattenOutline(parseOutline(source)).map((node) => node.id),
    )
    expect(new Set(flattenOutline(parseOutline(source)).map((node) => node.id)).size).toBe(3)
  })

  it("flattens depth-first so reading order matches the document", () => {
    const root = parseOutline(["# 标题", "## 甲", "### 甲一", "## 乙"].join("\n"))

    expect(flattenOutline(root).map((node) => node.title)).toEqual(["标题", "甲", "甲一", "乙"])
  })
})
