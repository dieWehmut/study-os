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

  it("reads a nested list as 层级", () => {
    // 语料里 72 篇有 62 篇嵌到两层以上，而网格把孙节点画成了「什么都没有」——
    // 一个子节点只剩 `· 标题` 一行，它自己底下的话一句也不上图。
    // structures.md §1.4 把「嵌套深度」正好指给层级当编码手段。
    const nested = [
      "## 词类",
      "- 实词",
      "  - 名词",
      "    - 专有名词",
      "  - 动词",
      "- 虚词",
      "  - 介词",
    ].join("\n")

    expect(readingOf(nested)).toBe("层级")
  })

  it("keeps a numbered hierarchy as 流程, because 层级 draws no arrows", () => {
    // structures.md §1.3：层级不加箭头，只用量的差异编码等级；
    // 「层级加箭头会被读成步骤」。反过来也一样 —— 有序号的材料读者要的是顺序，
    // 把它画成不带箭头的树，顺序那条信息就没了。
    const steps = ["## 步骤", "1. 加热", "  - 控温", "  - 计时", "2. 冷却", "  - 静置"].join("\n")

    expect(readingOf(steps)).toBe("流程")
  })

  it("prefers 层级 over 发散 when the branches themselves branch", () => {
    // 两条都能成立时，环画不出孙节点（和网格一样丢掉），树画得出。
    // 发散的前提是子主题彼此平权，而子主题自己还在分层，它们就不是平权的。
    const nested = ["这是一段总述。", "- 甲", "  - 一", "    - i", "- 乙", "  - 二"].join("\n")

    expect(readingOf(nested)).toBe("层级")
  })

  it("reads a section whose subsections have prose of their own as 层级", () => {
    // 浏览器里撞上的：`#/##/###` 三层标题，第三层底下是散文而不是第四层标题，
    // 所以「有没有孙节点」这条判据整个漏掉了它 —— 而网格照样把
    // 「表示人或事物的名称。」一个字都不画，只留一行 `· 名词`。
    // 埋掉的是子节点自己的话，不只是孙节点。
    const sections = [
      "# 现代汉语词类",
      "## 实词",
      "### 名词",
      "表示人或事物的名称。",
      "### 动词",
      "表示动作或状态。",
      "## 虚词",
      "### 介词",
      "用在名词前，组成介词短语。",
    ].join("\n")

    expect(readingOf(sections)).toBe("层级")
  })

  it("leaves a list of bare bullets as 并列", () => {
    // 子节点只有标题时，`· 一` 已经把它说完了 —— 没有被埋掉的话，
    // 树就只是把同样的字摊得更高。
    expect(readingOf(["## 甲", "- 一", "  - A", "  - B", "- 二"].join("\n"))).toBe("并列")
  })

  it("keeps a big hierarchy in a grid rather than drawing a tree no one can scroll", () => {
    // 跟环那条同一个教训，而我先算错了一次：树高是叶子数的线性函数，环的半径
    // 是超线性的，于是我以为线性就不用管 —— 咬人的是系数。语料量出来最矮的
    // 那棵树 23 个盒子已经 10575px，最高的 65137px，而同一篇画成网格是 1830px。
    // 一个盒子光标题也要 28+23=51px，加 24px 间距就是每层 75px；一张还算一幅图
    // 的卡到 1600px 左右，所以竖着摞得下大约 21 个。
    const big = ["## 目录"]
    for (let index = 0; index < 12; index += 1) {
      big.push(`- 第${index}章`, `  - 第${index}节`, `    - 第${index}条`)
    }

    expect(readingOf(big.join("\n"))).toBe("并列")
  })

  it("falls back to 并列 for a single block", () => {
    // 一个块没有结构可言。并列是根结构，落回它永远是合法输出。
    expect(readingOf("## 只有一节")).toBe("并列")
  })

  it("falls back to 并列 for nothing at all", () => {
    expect(classify([], [])).toBe("并列")
  })
})
