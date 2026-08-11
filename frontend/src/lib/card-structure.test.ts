import { describe, expect, it } from "vitest"

import { readCard } from "./card-blocks"
import { classify } from "./card-structure"
import { parseOutline } from "./outline"

const readingOf = (markdown: string) => {
  const { centre, blocks } = readCard(parseOutline(markdown))
  return classify(blocks, centre)
}

describe("structure classification", () => {
  it("reads a plain list as 并列", () => {
    expect(readingOf(["## 条件", "- 光照", "- 温度", "- 水分"].join("\n"))).toBe("并列")
  })

  it("reads a numbered list as 流程", () => {
    // structures.md §1.1: 流程 = 并列 + 箭头 + 序号。
    expect(readingOf(["## 步骤", "1. 加热", "2. 冷却", "3. 结晶"].join("\n"))).toBe("流程")
  })

  it("reads arrows in the titles as 流程 even without numbering", () => {
    expect(readingOf(["## 通路", "- 光能 → ATP", "- ATP → 糖"].join("\n"))).toBe("流程")
  })

  it("reads a numbered list that names its first step again at the end as 循环", () => {
    // 循环 = 流程 + 闭合。闭合的一种写法是末项又提了首项的名字。
    expect(readingOf(["## 三态", "1. 固态", "2. 液态", "3. 气态凝华回固态"].join("\n"))).toBe("循环")
  })

  it("reads an explicit return marker as 闭合 too", () => {
    expect(readingOf(["## 细胞周期", "1. 间期", "2. 分裂期", "3. 回到间期"].join("\n"))).toBe("循环")
  })

  it("reads a list under its own prose as 发散", () => {
    // 并列 vs 发散 的分界是中心有没有内容（structures.md §1.3）。
    // 这里的散文写在根上，它就是中心主题。
    expect(
      readingOf(["光合作用是绿色植物制造有机物的过程。", "- 光反应", "- 暗反应"].join("\n")),
    ).toBe("发散")
  })

  it("prefers 流程 over 发散 when the steps are numbered", () => {
    // 有中心又有序号时，读者要的是顺序。中心可以画在旁边，
    // 顺序画错了整张图就是错的。
    expect(readingOf(["这是一段总述。", "1. 第一步", "2. 第二步"].join("\n"))).toBe("流程")
  })

  it("keeps a heavy list in a grid even though it has a centre", () => {
    // 语料把这件事说死了：sample/distill 里 48 篇读成发散，最重的那个块
    // 没有一篇在 3 行以内，中位数 14 行、最多 72 行。环的预算是周长，
    // 撑开 n 个盒子的半径又随盒子对角线长，所以段落级的节点不只是难看 ——
    // 它把其余每个节点一起往外推：最重的那篇画出来 8357px 宽，
    // 而任何网格都封在 1624。段落该进网格。
    const heavy = ["这是一段总述。", "- 甲", "  - 一", "  - 二", "  - 三", "  - 四", "- 乙"].join("\n")

    expect(readingOf(heavy)).toBe("并列")
  })

  it("draws a heavy cycle as a sequence rather than an unreadable ring", () => {
    // 闭合那一条信息确实丢了。但落回的是并列→流程这条推导链的上一环，
    // 不是掉出链外：编号和箭头都还在，丢的只有绕回去那一根。
    // 用一根箭头换整张图可读，这个换是值的。
    const heavy = [
      "## 周期",
      "1. 间期",
      "  - 一",
      "  - 二",
      "  - 三",
      "  - 四",
      "2. 分裂期",
      "3. 回到间期",
    ].join("\n")

    expect(readingOf(heavy)).toBe("流程")
  })

  it("falls back to 并列 for a single block", () => {
    // 一个块没有结构可言。并列是根结构，落回它永远是合法输出。
    expect(readingOf("## 只有一节")).toBe("并列")
  })

  it("falls back to 并列 for nothing at all", () => {
    expect(classify([], [])).toBe("并列")
  })
})
