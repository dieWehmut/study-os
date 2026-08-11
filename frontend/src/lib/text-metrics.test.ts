import { describe, expect, it } from "vitest"

import { measure, wrap } from "./text-metrics"

describe("text metrics", () => {
  it("gives a CJK character a full em", () => {
    expect(measure("字", 20)).toBe(20)
  })

  it("gives a narrow latin letter far less than a wide one", () => {
    // i 和 W 在同一个字号下差三倍。把它们算成同一个宽度，一行 `if (x) {`
    // 会被高估近一倍，卡片就会为一段根本不存在的文字留出一整列白。
    expect(measure("i", 20)).toBeLessThan(measure("W", 20))
    expect(measure("W", 20)).toBeLessThan(measure("字", 20))
  })

  it("counts fullwidth punctuation as a CJK character", () => {
    // 「，」和「,」在等宽表里是两个字符。中文正文里前者占满一格。
    expect(measure("，", 20)).toBe(measure("字", 20))
  })

  it("scales linearly with font size", () => {
    expect(measure("知识点", 24)).toBe(measure("知识点", 12) * 2)
  })

  it("wraps at the width it was given", () => {
    const lines = wrap("一二三四五六七八九十", 20, 100)

    expect(lines).toEqual(["一二三四五", "六七八九十"])
  })

  it("never returns a line wider than the budget", () => {
    const text = "光合作用分为光反应和暗反应两个阶段，前者在类囊体薄膜上进行"
    for (const line of wrap(text, 16, 180)) {
      expect(measure(line, 16)).toBeLessThanOrEqual(180)
    }
  })

  it("does not cut a latin word in half", () => {
    // 「pho / tosynthesis」不是断行，是把一个词毁掉。中文没有词边界，
    // 逐字断是对的；拉丁文有空格，那就是作者标好的断点。
    expect(wrap("alpha beta gamma", 20, 130)).toEqual(["alpha beta", "gamma"])
  })

  it("breaks a latin word that cannot fit on a line of its own", () => {
    // 宁可切开也不能溢出：一个比整行还长的词如果整段留着，
    // 它会捅穿卡片右边，而卡片没有裁切路径。
    for (const line of wrap("supercalifragilistic", 20, 60)) {
      expect(measure(line, 20)).toBeLessThanOrEqual(60)
    }
  })

  it("keeps every character it was given", () => {
    const text = "混合 text 与中文 mixed 的一行"
    expect(wrap(text, 16, 90).join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""))
  })
})
