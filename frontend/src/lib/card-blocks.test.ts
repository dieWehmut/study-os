import { describe, expect, it } from "vitest"

import { readCard } from "./card-blocks"
import { parseOutline } from "./outline"

const cardOf = (markdown: string) => readCard(parseOutline(markdown))

describe("card blocks", () => {
  it("makes one block per section", () => {
    const { blocks } = cardOf(["# 光合作用", "## 光反应", "## 暗反应"].join("\n"))

    expect(blocks.map((block) => block.title)).toEqual(["光反应", "暗反应"])
  })

  it("descends through a lone section to the things inside it", () => {
    // 一篇 wiki 常写成「## 条件」底下挂三条。照根画出来是一个方框装着三行字 ——
    // 那正是 0807:41 说的方框长条。真正在并列的是那三条，就画那三条。
    const { blocks } = cardOf(["## 条件", "- 光照", "- 温度", "- 水分"].join("\n"))

    expect(blocks.map((block) => block.title)).toEqual(["光照", "温度", "水分"])
  })

  it("stops descending at a section that has nothing inside it", () => {
    // 往下走一层的前提是下面还有东西。走进一个空节点，卡片就什么都没有了。
    const { blocks } = cardOf(["## 光反应", "发生在类囊体薄膜上。"].join("\n"))

    expect(blocks.map((block) => block.title)).toEqual(["光反应"])
    expect(blocks[0].lines).toEqual(["发生在类囊体薄膜上。"])
    expect(blocks[0].fields).toEqual([])
  })

  it("hands back the prose written above the blocks as the centre", () => {
    // 并列 vs 发散 的分界就是它有没有内容（structures.md §1.3），
    // 所以读块的时候必须一并把它读出来，不能让下游再去树里找一次。
    const { centre, blocks } = cardOf(
      ["光合作用是绿色植物制造有机物的过程。", "- 光反应", "- 暗反应"].join("\n"),
    )

    expect(centre).toEqual(["光合作用是绿色植物制造有机物的过程。"])
    expect(blocks).toHaveLength(2)
  })

  it("takes the centre from wherever it stopped descending", () => {
    const { centre, blocks } = cardOf(["## 术语", "这是一段总述。", "### 甲", "### 乙"].join("\n"))

    expect(centre).toEqual(["这是一段总述。"])
    expect(blocks.map((block) => block.title)).toEqual(["甲", "乙"])
  })

  it("reads a table row's cells back into named fields", () => {
    // parseOutline 把一行表格编码成了「表头：值」的散文。几何要按名字归列，
    // 所以这里把它再拆回来 —— 名字本来就写在每一行上。
    const { blocks } = cardOf(
      ["| 概念 | 定义 | 例子 |", "| --- | --- | --- |", "| 动量 | mv | 小球碰撞 |"].join("\n"),
    )

    expect(blocks[0].title).toBe("动量")
    expect(blocks[0].fields).toEqual([
      { name: "定义", value: "mv" },
      { name: "例子", value: "小球碰撞" },
    ])
    expect(blocks[0].lines).toEqual([])
  })

  it("leaves a sentence with a colon in it as a line, not a field", () => {
    // 字段名是名字，不是半句话。一句「它得出的结论是这样的：后面还有很长一段」
    // 被当成字段，几何会拿这半句话去当列头。
    const { blocks } = cardOf(
      ["## 结论", "它得出的结论是这样的：后面还有很长的一段说明"].join("\n"),
    )

    expect(blocks[0].fields).toEqual([])
    expect(blocks[0].lines).toEqual(["它得出的结论是这样的：后面还有很长的一段说明"])
  })

  it("does not read a url as a field", () => {
    const { blocks } = cardOf(["## 出处", "https://example.com/a"].join("\n"))

    expect(blocks[0].fields).toEqual([])
  })

  it("refuses a short name that is already two sentences", () => {
    // 长度分不开这两拨东西 —— 语料里真表头的中位数是 2 字、p90 是 9 字，
    // 而散文冒号前缀的中位数就是 9 字。句末标点才是那条锐利的界线：
    // 字段名是个名字，名字里不会有句号。
    const { blocks } = cardOf(["## 结论", "对。所以：后面还有很长的一段说明"].join("\n"))

    expect(blocks[0].fields).toEqual([])
    expect(blocks[0].lines).toEqual(["对。所以：后面还有很长的一段说明"])
  })

  it("nests a section's sub-sections as child blocks", () => {
    const { blocks } = cardOf(["## 甲", "## 乙", "### 乙一"].join("\n"))

    expect(blocks.map((block) => block.title)).toEqual(["甲", "乙"])
    expect(blocks[1].children.map((child) => child.title)).toEqual(["乙一"])
  })

  it("carries the ordered flag through", () => {
    const { blocks } = cardOf(["## 步骤", "1. 加热", "2. 冷却"].join("\n"))

    expect(blocks.map((block) => block.ordered)).toEqual([true, true])
  })

  it("gives every block the id the outline gave its node", () => {
    // 卡片是每次重画的，但 React key 和测试选择器需要一个跨渲染稳定的名字，
    // 而 outline 的 id 已经是从位置推出来的，稳定就是它的定义。
    const source = ["## 甲", "## 乙"].join("\n")

    expect(new Set(cardOf(source).blocks.map((block) => block.id)).size).toBe(2)
    expect(cardOf(source).blocks[0].id).toBe(cardOf(source).blocks[0].id)
  })

  it("returns nothing for an empty document", () => {
    expect(readCard(parseOutline(""))).toEqual({ centre: [], blocks: [] })
  })
})
