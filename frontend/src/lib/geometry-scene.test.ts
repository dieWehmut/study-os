import { describe, expect, it } from "vitest"

import {
  defaultTriangleScene,
  validateGeometryScene,
  type GeometryScene,
} from "./geometry-scene"

describe("controlled geometry scene protocol", () => {
  it("accepts a declarative triangle with a sampled function graph", () => {
    const scene: GeometryScene = {
      ...defaultTriangleScene,
      graphs: [
        {
          id: "parabola",
          samples: [{ x: 20, y: 80 }, { x: 60, y: 40 }, { x: 100, y: 80 }],
          label: "y = (x - 60)² / 20",
        },
      ],
    }

    expect(validateGeometryScene(scene)).toEqual({ ok: true, errors: [] })
  })

  it("rejects duplicate ids, dangling references, degenerate segments and unsafe numbers", () => {
    const invalid: GeometryScene = {
      version: 1,
      title: "bad",
      viewBox: { width: 200, height: 120 },
      points: [
        { id: "A", x: 20, y: 80 },
        { id: "A", x: 20, y: 80 },
      ],
      segments: [{ id: "AB", from: "A", to: "B" }],
      circles: [{ id: "c", center: "A", radius: Number.NaN }],
      graphs: [],
      conditions: [],
    }

    const result = validateGeometryScene(invalid)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual(expect.arrayContaining([
      "点 ID 重复：A",
      "线段 AB 引用了不存在的点：B",
      "圆 c 的半径必须是正数",
    ]))
  })

  it("rejects out-of-bounds coordinates and oversized labels before rendering", () => {
    const result = validateGeometryScene({
      ...defaultTriangleScene,
      title: "x".repeat(201),
      points: [{ id: "A", x: -1, y: 20 }],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual(expect.arrayContaining([
      "标题不能超过 200 个字符",
      "点 A 超出画布范围",
    ]))
  })
})
