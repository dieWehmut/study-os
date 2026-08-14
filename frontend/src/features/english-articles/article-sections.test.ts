import { describe, expect, it } from "vitest"

import { articleSectionID, articleSectionIDs, sectionHash } from "./article-sections"

describe("English article section routes", () => {
  it("keeps stable readable ids for English and Chinese headings", () => {
    expect(articleSectionID("Market Shifts", 0)).toBe("section-1-market-shifts")
    expect(articleSectionID("就业冲击", 1)).toBe("section-2-就业冲击")
  })

  it("does not merge duplicate or punctuation-only headings", () => {
    expect(articleSectionIDs(["The Turn", "The Turn", "...", "..."])).toEqual([
      "section-1-the-turn",
      "section-2-the-turn",
      "section-3",
      "section-4",
    ])
  })

  it("encodes a section id as a URL hash", () => {
    expect(sectionHash("section-2-就业冲击")).toBe("#section-2-%E5%B0%B1%E4%B8%9A%E5%86%B2%E5%87%BB")
  })
})
