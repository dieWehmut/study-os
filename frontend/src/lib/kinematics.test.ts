import { describe, expect, it } from "vitest"

import { checkStages, solveStage, type Stage } from "./kinematics"

function stage(name: string, known: Partial<Omit<Stage, "id" | "name">>): Stage {
  return { id: name, name, v0: null, v: null, a: null, t: null, x: null, ...known }
}

describe("filling in one stage of a motion", () => {
  it("finds the末速度 you did not write from v0, a and t", () => {
    // v = v0 + at. The point of the板 is that you wrote three numbers and the
    // fourth was always available -- not writing it is how a stage gets skipped.
    const solved = solveStage(stage("加速", { v0: 2, a: 3, t: 4 }))

    expect(solved.v).toBeCloseTo(14, 9)
    expect(solved.derived).toContain("v")
  })

  it("finds the位移 from v0, a and t", () => {
    // x = v0·t + ½at².
    const solved = solveStage(stage("加速", { v0: 2, a: 3, t: 4 }))

    expect(solved.x).toBeCloseTo(32, 9)
    expect(solved.derived).toContain("x")
  })

  it("finds the加速度 from v0, v and t", () => {
    const solved = solveStage(stage("刹车", { v0: 20, v: 0, t: 5 }))

    expect(solved.a).toBeCloseTo(-4, 9)
    expect(solved.derived).toContain("a")
  })

  it("uses v² - v0² = 2ax when no time was given", () => {
    // The one relation students reach for last, and the only one that works
    // when the问题 never mentions时间.
    const solved = solveStage(stage("下滑", { v0: 0, v: 10, a: 5 }))

    expect(solved.x).toBeCloseTo(10, 9)
    expect(solved.t).toBeCloseTo(2, 9)
  })

  it("leaves a stage alone when two quantities are still missing", () => {
    // Three knowns is the threshold. Inventing a number from two would be
    // worse than an empty box, because it looks like an answer.
    const solved = solveStage(stage("未知", { v0: 5 }))

    expect(solved.v).toBeNull()
    expect(solved.a).toBeNull()
    expect(solved.derived).toEqual([])
  })

  it("does not overwrite a number you wrote yourself", () => {
    // If your v disagrees with v0 + at, the disagreement is the finding.
    // Silently replacing it would erase the mistake you came here to see.
    const solved = solveStage(stage("矛盾", { v0: 2, a: 3, t: 4, v: 99 }))

    expect(solved.v).toBe(99)
    expect(solved.derived).not.toContain("v")
  })
})

describe("checking a divided motion for what does not join up", () => {
  it("says nothing about a motion you have not divided yet", () => {
    expect(checkStages([])).toEqual([])
  })

  it("flags a stage whose own numbers contradict each other", () => {
    // v0 = 2, a = 3, t = 4 gives v = 14, not 99. Written by hand, this is the
    // arithmetic slip that survives to the answer line.
    const warnings = checkStages([solveStage(stage("矛盾", { v0: 2, a: 3, t: 4, v: 99 }))])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("矛盾")
  })

  it("flags a seam where one stage does not start where the last one ended", () => {
    // The reason to divide the process at all: 末速度 of one stage is 初速度 of
    // the next, and a seam that jumps is a stage you have not accounted for.
    const warnings = checkStages([
      solveStage(stage("加速", { v0: 0, a: 2, t: 5 })),
      solveStage(stage("匀速", { v0: 3, a: 0, t: 2 })),
    ])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("匀速")
  })

  it("says nothing when the stages join up", () => {
    expect(
      checkStages([
        solveStage(stage("加速", { v0: 0, a: 2, t: 5 })),
        solveStage(stage("匀速", { v0: 10, a: 0, t: 2 })),
      ]),
    ).toEqual([])
  })

  it("does not call a seam broken when the next stage never said its 初速度", () => {
    // A blank is not a disagreement. Warning about it would make the board
    // nag while you are still filling it in.
    expect(
      checkStages([solveStage(stage("加速", { v0: 0, a: 2, t: 5 })), solveStage(stage("未知", {}))]),
    ).toEqual([])
  })
})
