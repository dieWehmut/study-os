import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { VisualCard } from "./VisualCard"

describe("VisualCard", () => {
  it("names itself by the term and the structure it drew", () => {
    // 一张图对读屏软件只是一块空白，除非它自己说出画的是什么形状。
    render(<VisualCard markdown={["## 步骤", "1. 加热", "2. 冷却"].join("\n")} title="结晶" />)

    expect(screen.getByRole("img", { name: /结晶/ })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /流程/ })).toBeInTheDocument()
  })

  it("draws one box per section", () => {
    const { container } = render(
      <VisualCard markdown={["## 甲", "## 乙", "## 丙"].join("\n")} title="词条" />,
    )

    expect(container.querySelectorAll("[data-block]")).toHaveLength(3)
  })

  it("sizes the viewBox from the frame it was given", () => {
    // 画布是算出来的，viewBox 得跟它一致 —— 不一致的话要么裁掉一块，
    // 要么在下面留一条白，而两种都看不出是错的。
    const { container } = render(<VisualCard markdown={["## 甲", "## 乙"].join("\n")} title="词条" />)
    const svg = container.querySelector("svg")!

    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${svg.dataset.width} ${svg.dataset.height}`)
    expect(Number(svg.dataset.height)).toBeGreaterThan(0)
  })

  it("names itself from the document when the caller has no name for it", () => {
    // 阅读页粘进来的文章自带 `# 标题`，调用方没有别的名字可给 —— 而把名字
    // 当参数传进去反而更糟：parseOutline 见到 root 已有标题，就把 `# 标题`
    // 降成一个子节点，整篇于是只剩一个块，什么也画不出来。
    render(<VisualCard markdown={["# 光合作用", "## 光反应", "## 暗反应"].join("\n")} />)

    expect(screen.getByRole("img", { name: /^光合作用·/ })).toBeInTheDocument()
  })

  it("keeps the text at its own size and lets the card scroll instead", () => {
    // 手动验的时候撞上的：知识库的面板在 1029px 窗口下只有 309px 宽，
    // 而卡片天生 ≥640px，`width="100%"` 就把整张图缩到 34% —— 正文
    // 14px 变成 4.8px，一个字也读不了。缩放是有代价的选择，而卡片是
    // 拿来读的，读不了就等于没画。宽度写死成算出来的那个数，装不下的
    // 时候横向滚动：要平移，但字还在。
    const { container } = render(
      <VisualCard markdown={["## 甲", "## 乙", "## 丙"].join("\n")} title="词条" />,
    )
    const svg = container.querySelector("svg")!

    expect(svg.getAttribute("width")).toBe(svg.dataset.width)
    expect(svg.parentElement?.className).toContain("overflow-x-auto")
  })

  it("says so instead of drawing an empty box", () => {
    render(<VisualCard markdown="" title="词条" />)

    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText(/还没有/)).toBeInTheDocument()
  })

  it("says so when there is only one section to draw", () => {
    // 一个块没有结构可言，画出来的是一个方框 —— 那正是这套东西要避免的东西。
    render(<VisualCard markdown="## 只有一节" title="词条" />)

    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText(/只有一段|没有可拆/)).toBeInTheDocument()
  })

  it("does not call the material a 百科 when it might not be one", () => {
    // 同一个组件也画阅读页粘进来的文章。空状态要是写死「百科」，
    // 在那儿就是个错字 —— 而错字出现的时机恰好是没画出图的时候，
    // 也就是读者最需要看懂为什么的时候。
    render(<VisualCard markdown="## 只有一节" />)

    expect(screen.queryByText(/百科/)).not.toBeInTheDocument()
  })
})
