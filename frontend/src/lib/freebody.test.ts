import { describe, expect, it } from "vitest"

import { checkForces, resolveForces, type Force } from "./freebody"

function force(name: string, magnitude: number, angle: number, kind: Force["kind"] = "contact"): Force {
  return { id: name, name, magnitude, angle, kind }
}

describe("resolving a free-body diagram", () => {
  it("calls a body with nothing on it balanced, and gives it no direction", () => {
    // A resultant of zero has a magnitude but no direction at all. Reporting
    // 0° would name a way the body is being pushed when it is not being pushed.
    const resultant = resolveForces([])

    expect(resultant.balanced).toBe(true)
    expect(resultant.magnitude).toBe(0)
    expect(resultant.angle).toBeNull()
  })

  it("cancels two equal forces pointing opposite ways", () => {
    // The whole point of drawing it: 平衡 has to come out as平衡 and not as a
    // residue left by sin(180°), which is 1.2e-16 rather than 0.
    const resultant = resolveForces([force("重力", 10, 270, "field"), force("支持力", 10, 90)])

    expect(resultant.balanced).toBe(true)
    expect(resultant.magnitude).toBeCloseTo(0, 9)
  })

  it("adds forces as vectors, not as numbers", () => {
    // 3 N right and 4 N up is 5 N, never 7 N. Adding magnitudes is the mistake
    // this drawing exists to stop.
    const resultant = resolveForces([force("拉力", 3, 0), force("支持力", 4, 90)])

    expect(resultant.magnitude).toBeCloseTo(5, 9)
    expect(resultant.angle).toBeCloseTo(53.13, 2)
    expect(resultant.balanced).toBe(false)
  })

  it("reports a direction in [0, 360) rather than a negative angle", () => {
    // Every angle in the panel is read off the same circle, so one that came
    // back as -90 would sort and draw differently from the 270 beside it.
    const resultant = resolveForces([force("重力", 8, -90, "field")])

    expect(resultant.angle).toBeCloseTo(270, 9)
  })

  it("keeps 平衡 a question about the forces, not about their units", () => {
    // A 0.001 N residue is balanced next to two 1000 N forces and is not
    // balanced next to two 0.002 N ones. A fixed epsilon would call both the
    // same, which is wrong in one direction or the other whichever value it is.
    const large = resolveForces([force("F1", 1000, 0), force("F2", 1000.000001, 180)])
    const small = resolveForces([force("F1", 0.001, 0), force("F2", 0.002, 180)])

    expect(large.balanced).toBe(true)
    expect(small.balanced).toBe(false)
  })
})

describe("checking a free-body diagram for what is missing", () => {
  it("says nothing about a body you have not started drawing", () => {
    // An empty canvas is not a wrong answer. Warnings before the first force
    // would train you to ignore them.
    expect(checkForces([])).toEqual([])
  })

  it("asks for 重力 when every force drawn is a contact force", () => {
    // The single most common omission, and the reason the advice says to mark
    // 场力 last: it is the one force with nothing touching to remind you.
    const warnings = checkForces([force("支持力", 10, 90), force("摩擦力", 3, 180)])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("重力")
  })

  it("stops asking once a field force is on the diagram", () => {
    expect(checkForces([force("支持力", 10, 90), force("重力", 10, 270, "field")])).toEqual([])
  })

  it("does not invent a force that is only touching, not pushing", () => {
    // 0 N is a real answer -- "the rope is slack" -- and the drawing has to be
    // able to say it without being told it forgot something.
    expect(checkForces([force("重力", 10, 270, "field"), force("拉力", 0, 90)])).toEqual([])
  })

  it("flags two forces drawn along the same line as one you may have split", () => {
    // Two 接触力 at the same angle is almost always one surface counted twice
    // -- 支持力 written once as 支持力 and once as 弹力.
    const warnings = checkForces([
      force("重力", 10, 270, "field"),
      force("支持力", 6, 90),
      force("弹力", 4, 90),
    ])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("支持力")
    expect(warnings[0]).toContain("弹力")
  })
})
