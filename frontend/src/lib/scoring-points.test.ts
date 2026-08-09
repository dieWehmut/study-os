import { describe, expect, it } from "vitest"

import { checkCoverage } from "./scoring-points"

function points(...texts: string[]) {
  return texts.map((text) => ({ text }))
}

describe("laying an answer against the 得分点 it was meant to hit", () => {
  it("counts a point written out word for word as hit", () => {
    const checked = checkCoverage(
      points("借景抒情"),
      "这两句借景抒情，把离别写得很含蓄。",
    )

    expect(checked.points[0]?.verdict).toBe("hit")
    expect(checked.points[0]?.matched).toBe("借景抒情")
  })

  it("names the point that is not in the answer at all", () => {
    const checked = checkCoverage(
      points("借景抒情", "对比手法"),
      "这两句借景抒情，把离别写得很含蓄。",
    )

    expect(checked.points[1]?.verdict).toBe("missing")
    expect(checked.points[1]?.matched).toBeNull()
    expect(checked.hit).toBe(1)
    expect(checked.total).toBe(2)
  })

  it("takes either wording when the 答案 offers a choice", () => {
    // 答案 are written with alternatives -- 对比/衬托 -- and only one of them
    // has to be in your answer for the point to be yours.
    const checked = checkCoverage(points("对比/衬托"), "上下两句形成衬托。")

    expect(checked.points[0]?.verdict).toBe("hit")
    expect(checked.points[0]?.matched).toBe("衬托")
  })

  it("counts the point when you said it in more words", () => {
    // 借景抒情 written out as 借助景物抒发情感 is the same point scored, and a
    // check that missed it would mark a correct answer down.
    const checked = checkCoverage(points("借景抒情"), "作者借助景物抒发情感。")

    expect(checked.points[0]?.verdict).toBe("hit")
    expect(checked.points[0]?.matched).toContain("借助景物抒发情")
  })

  it("will not stitch a point together out of characters strewn across the answer", () => {
    // The whole value of a coverage check is that a missing point stays
    // missing. A rule loose enough to find 借景抒情 anywhere would report every
    // point hit and score nothing.
    const checked = checkCoverage(
      points("借景抒情"),
      "借着这个机会，我想说说自己读到的景象，以及后面几句抒写的那种深沉的情",
    )

    expect(checked.points[0]?.verdict).toBe("missing")
  })

  it("is not stopped by the punctuation between the words", () => {
    const checked = checkCoverage(points("借景抒情"), "借景、抒情，两句都有。")

    expect(checked.points[0]?.verdict).toBe("hit")
  })

  it("marks every point missing when nothing was written", () => {
    const checked = checkCoverage(points("借景抒情", "对比手法"), "")

    expect(checked.points.map((point) => point.verdict)).toEqual(["missing", "missing"])
    expect(checked.hit).toBe(0)
  })

  it("has nothing to count when no 得分点 were given", () => {
    const checked = checkCoverage([], "这两句借景抒情。")

    expect(checked.points).toEqual([])
    expect(checked.total).toBe(0)
    expect(checked.hit).toBe(0)
  })
})
