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
    // 卡片自己算出宽高，元素按容器给的宽度缩放 —— 尺寸不锁，
    // 但也不能因此把图顶出面板。
    const { container } = render(<VisualCard markdown={["## 甲", "## 乙"].join("\n")} title="词条" />)
    const svg = container.querySelector("svg")!

    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${svg.dataset.width} ${svg.dataset.height}`)
    expect(Number(svg.dataset.height)).toBeGreaterThan(0)
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
})
