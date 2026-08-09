import { describe, expect, it } from "vitest"

import { checkChain } from "./causal-chain"

function verdicts(links: { cause: string; effect: string }[]): string[] {
  return checkChain(links).links.map((link) => link.verdict)
}

describe("checking a 因果链 link against link", () => {
  it("lets a chain through when each link picks up where the last ended", () => {
    const checked = checkChain([
      { cause: "太阳辐射强", effect: "地表增温" },
      { cause: "地表增温", effect: "空气受热上升" },
      { cause: "空气受热上升", effect: "近地面形成低压" },
    ])

    expect(checked.gaps).toEqual([])
    expect(checked.joined).toBe(true)
    expect(checked.links.map((link) => link.verdict)).toEqual(["start", "joins", "joins"])
  })

  it("names the link that does not pick up where the last one ended", () => {
    const checked = checkChain([
      { cause: "太阳辐射强", effect: "地表增温" },
      { cause: "沿岸有寒流", effect: "近地面形成低压" },
    ])

    expect(checked.gaps).toEqual([1])
    expect(checked.links[1]?.verdict).toBe("detached")
    // The note has to name both ends, since the fix is the 环 that goes between
    // them and you cannot write it from one end alone.
    expect(checked.links[1]?.note).toContain("地表增温")
    expect(checked.links[1]?.note).toContain("沿岸有寒流")
  })

  it("reports every gap, not only the first", () => {
    // Unlike a derivation, a later link is not downstream of an earlier break:
    // it is a separate claim that stands or falls on its own. Stopping at the
    // first gap would hide the second 丢分点, which is usually the one you
    // would not have found.
    const checked = checkChain([
      { cause: "太阳辐射强", effect: "地表增温" },
      { cause: "沿岸有寒流", effect: "水汽难以凝结" },
      { cause: "水汽难以凝结", effect: "降水稀少" },
      { cause: "地形闭塞", effect: "植被稀疏" },
    ])

    expect(checked.gaps).toEqual([1, 3])
    expect(checked.joined).toBe(false)
  })

  it("takes a longer restatement of the last result as the same link", () => {
    // 地表增温 and 地表增温、空气膨胀 are the same 环 written at two lengths,
    // and a check that called that a gap would be wrong on every real answer.
    expect(
      checkChain([
        { cause: "太阳辐射强", effect: "地表增温" },
        { cause: "地表增温、空气膨胀", effect: "空气上升" },
      ]).gaps,
    ).toEqual([])
  })

  it("does not let spacing or a full stop break a join", () => {
    expect(
      checkChain([
        { cause: "太阳辐射强", effect: "地表增温。" },
        { cause: " 地表增温 ", effect: "空气上升" },
      ]).gaps,
    ).toEqual([])
  })

  it("calls a half-written link unfinished rather than detached", () => {
    // Pointing at a join failure when you simply have not typed the other half
    // yet would send you looking for a missing 环 that is not missing.
    const checked = checkChain([
      { cause: "太阳辐射强", effect: "地表增温" },
      { cause: "地表增温", effect: "" },
    ])

    expect(checked.links[1]?.verdict).toBe("empty")
    expect(checked.gaps).toEqual([])
    expect(checked.joined).toBe(false)
  })

  it("does not blame the link after an unfinished one for not joining it", () => {
    // One unfinished line is one problem. Measuring the next link against a
    // blank would report it twice and name the wrong 环 the second time.
    const checked = checkChain([
      { cause: "太阳辐射强", effect: "地表增温" },
      { cause: "地表增温", effect: "" },
      { cause: "地表增温", effect: "空气上升" },
    ])

    expect(verdicts([
      { cause: "太阳辐射强", effect: "地表增温" },
      { cause: "地表增温", effect: "" },
      { cause: "地表增温", effect: "空气上升" },
    ])).toEqual(["start", "empty", "joins"])
    expect(checked.gaps).toEqual([])
  })

  it("has nothing to say about a single link, or none", () => {
    expect(verdicts([{ cause: "太阳辐射强", effect: "地表增温" }])).toEqual(["start"])
    expect(checkChain([]).links).toEqual([])
    expect(checkChain([]).gaps).toEqual([])
  })
})
