import { describe, expect, it } from "vitest"

import { readCard } from "./card-blocks"
import { layoutCard, type Frame } from "./card-layout"
import { classify } from "./card-structure"
import { parseOutline } from "./outline"

const frameOf = (markdown: string): Frame => {
  const { centre, blocks } = readCard(parseOutline(markdown))
  return layoutCard(blocks, classify(blocks, centre), centre)
}

/** Nothing drawn may sit outside the frame -- there is no clipping path. */
const inside = (frame: Frame) =>
  frame.shapes.every(
    (shape) =>
      shape.x >= 0 && shape.y >= 0 && shape.x + shape.w <= frame.w && shape.y + shape.h <= frame.h,
  )

const overlaps = (a: Frame["shapes"][number], b: Frame["shapes"][number]) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const list = ["## 条件", "- 光照", "- 温度", "- 水分"].join("\n")
const steps = ["## 步骤", "1. 加热", "2. 冷却", "3. 结晶"].join("\n")
const cycle = ["## 水循环", "1. 蒸发", "2. 凝结", "3. 降水", "4. 回到蒸发"].join("\n")
const radial = ["光合作用是绿色植物制造有机物的过程。", "- 光反应", "- 暗反应", "- 产物"].join("\n")

describe("card layout", () => {
  it("draws one shape per block", () => {
    expect(frameOf(list).shapes).toHaveLength(3)
  })

  it("keeps every shape inside the frame", () => {
    for (const source of [list, steps, cycle, radial]) {
      expect(inside(frameOf(source))).toBe(true)
    }
  })

  it("never overlaps two shapes", () => {
    for (const source of [list, steps, cycle, radial]) {
      const { shapes } = frameOf(source)
      for (let a = 0; a < shapes.length; a += 1) {
        for (let b = a + 1; b < shapes.length; b += 1) {
          expect(overlaps(shapes[a], shapes[b])).toBe(false)
        }
      }
    }
  })

  it("grows taller for more content instead of clipping it", () => {
    // 这条是整份设计的赌注。skill 的画布是常量，超出静默裁切；
    // 这里画布是算出来的，所以「不锁尺寸」不是一句要求自觉的话。
    const few = frameOf(["## 甲", "- 一", "- 二"].join("\n"))
    const many = frameOf(
      ["## 甲", ...Array.from({ length: 12 }, (_, index) => `- 第${index}项`)].join("\n"),
    )

    expect(many.h).toBeGreaterThan(few.h)
    expect(inside(many)).toBe(true)
  })

  it("grows taller for a long line rather than letting it run off the edge", () => {
    const short = frameOf(["## 甲", "- 一", "- 二"].join("\n"))
    const long = frameOf(
      ["## 甲", "- 一：这一条写得非常长，长到必须折成好几行才装得下，而卡片只能长高", "- 二"].join("\n"),
    )

    expect(long.h).toBeGreaterThan(short.h)
    expect(inside(long)).toBe(true)
  })

  it("wraps a very long line instead of widening the card without bound", () => {
    // 「不锁尺寸」说的是高度。宽度要是也不锁，一句长话就把卡横着摊开成
    // 一条 —— 那还是方框长条，只是躺下了。列宽有个阅读行长的上限，
    // 超出的部分必须由高度吸收，所以这两条断言得一起成立。
    const sentence = "这一条写得非常长，长到必须折成好几行才装得下，而卡片只能长高不能变宽，否则一张卡就横着摊成一条了"
    const long = frameOf(["## 甲", `- 一：${sentence}`, "- 二"].join("\n"))
    const longer = frameOf(["## 甲", `- 一：${sentence.repeat(3)}`, "- 二"].join("\n"))

    expect(longer.w).toBe(long.w)
    expect(longer.h).toBeGreaterThan(long.h)
    expect(inside(longer)).toBe(true)
  })

  it("keeps every text inside the frame too", () => {
    const frame = frameOf(radial)

    for (const text of frame.texts) {
      expect(text.x).toBeGreaterThanOrEqual(0)
      expect(text.y).toBeGreaterThanOrEqual(0)
      expect(text.x).toBeLessThanOrEqual(frame.w)
      expect(text.y).toBeLessThanOrEqual(frame.h)
    }
  })

  it("draws no arrows for 并列", () => {
    expect(frameOf(list).links.filter((link) => link.arrow)).toHaveLength(0)
  })

  it("draws an arrow between consecutive steps of a 流程", () => {
    expect(frameOf(steps).links.filter((link) => link.arrow)).toHaveLength(2)
  })

  it("closes the ring of a 循环", () => {
    // 四个块的环有四条边，不是三条 -- 末项回到首项那条就是「闭合」本身。
    expect(frameOf(cycle).links.filter((link) => link.arrow)).toHaveLength(4)
  })

  it("gives 发散 a centre that every branch is linked to", () => {
    const frame = frameOf(radial)

    // 三个分支 + 一个中心。
    expect(frame.shapes).toHaveLength(4)
    expect(frame.links).toHaveLength(3)
    expect(frame.links.every((link) => !link.arrow)).toBe(true)
  })

  it("is at least as wide as two columns need", () => {
    // 比这更窄的卡片放不下两列，所有骨架都会退化成一列 —— 那就又是方框长条了。
    expect(frameOf(list).w).toBeGreaterThanOrEqual(640)
  })

  it("gives the same markdown the same frame every time", () => {
    // 它能用来预习的前提：结构每次都一样，才值得先看一遍。
    expect(frameOf(steps)).toEqual(frameOf(steps))
  })

  it("draws nothing for nothing", () => {
    const frame = layoutCard([], "并列", [])

    expect(frame.shapes).toEqual([])
    expect(frame.h).toBe(0)
  })
})
