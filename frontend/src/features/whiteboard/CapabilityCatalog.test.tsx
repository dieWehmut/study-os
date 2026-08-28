import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CapabilityCatalog } from "./CapabilityCatalog"

describe("CapabilityCatalog", () => {
  it("starts with foundation capabilities and filters to a chosen tier", () => {
    render(<CapabilityCatalog />)

    expect(screen.getByRole("heading", { name: "白板能力目录" })).toBeInTheDocument()
    expect(screen.getByText("无限画布与快速移动")).toBeInTheDocument()
    expect(screen.queryByText("知识图谱与路径回放")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "进阶能力" }))
    expect(screen.getByText("知识图谱与路径回放")).toBeInTheDocument()
    expect(screen.queryByText("无限画布与快速移动")).not.toBeInTheDocument()
  })

  it("shows the learner value and explicit evidence status for a capability", () => {
    render(<CapabilityCatalog />)

    const row = screen.getByText("无限画布与快速移动").closest("article")
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent("把讲义、错题和自己的推导放在同一视野")
    expect(row).toHaveTextContent("待导入推荐视频字幕核验")
    expect(row).toHaveTextContent("Heptabase")
  })
})
