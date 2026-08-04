import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MindMap } from "./MindMap"
import { toMermaid } from "@/lib/mermaid"

describe("MindMap", () => {
  it("renders nodes as an svg diagram", () => {
    render(
      <MindMap
        data={{
          title: "运动学",
          nodes: [
            { id: "n0", label: "运动学", node_type: "root" },
            { id: "n1", label: "速度", parent_id: "n0", node_type: "branch" },
            { id: "n2", label: "加速度", parent_id: "n0", node_type: "conclusion" },
          ],
        }}
      />,
    )
    expect(screen.getByRole("img", { name: "导图：运动学" })).toBeInTheDocument()
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
