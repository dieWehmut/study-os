import { describe, expect, it } from "vitest"

import { SHARED_INSIGHT_TAGS, SUBJECT_INSIGHT_TAGS, insightTagsFor, tagOptionsFor } from "./insights"

describe("insight types, by subject", () => {
  it("names chemistry's own three rather than the generic ones", () => {
    // 0801: 「以后你独立总结出的『地理六类错因』，就可以作为地理学科的专属分类体系」.
    // The same holds for insight types -- 化学 sorts its conclusions by
    // 考点/题型/易错点, and calling them 二级结论 loses the sort.
    expect(insightTagsFor("chemistry")).toContain("考点")
    expect(insightTagsFor("chemistry")).not.toContain("二级结论")
  })

  it("falls back to the shared types while no subject is chosen", () => {
    expect(insightTagsFor("all")).toEqual([...SHARED_INSIGHT_TAGS])
  })

  it("falls back rather than throwing on a subject it has never heard of", () => {
    // Subjects come from the database, which is older than this table and will
    // outlive it. An unknown id costs you the tailored vocabulary, not the row.
    expect(insightTagsFor("astronomy")).toEqual([...SHARED_INSIGHT_TAGS])
  })

  it("gives every subject exactly three types, so the row never wraps", () => {
    for (const subject of Object.keys(SUBJECT_INSIGHT_TAGS)) {
      expect(insightTagsFor(subject)).toHaveLength(SHARED_INSIGHT_TAGS.length)
    }
  })

  it("never gives one subject the same type twice", () => {
    for (const subject of Object.keys(SUBJECT_INSIGHT_TAGS)) {
      const tags = insightTagsFor(subject)
      expect(new Set(tags).size).toBe(tags.length)
    }
  })
})

describe("the buttons offered for one item", () => {
  it("offers the subject's own vocabulary", () => {
    expect(tagOptionsFor("chemistry", [])).toEqual([...insightTagsFor("chemistry")])
  })

  it("keeps offering a tag the item already carries from another subject", () => {
    // Tag an item 考点 under 化学, then look at it under 全部学科: without this
    // the button disappears, and a tag you cannot see is a tag you cannot take
    // off. Every tag on an item must stay removable from wherever you find it.
    const options = tagOptionsFor("all", ["考点"])
    expect(options).toContain("考点")
    expect(options).toEqual(expect.arrayContaining([...SHARED_INSIGHT_TAGS]))
  })

  it("does not offer the same tag twice when it is already in the vocabulary", () => {
    const options = tagOptionsFor("all", ["二级结论"])
    expect(options.filter((tag) => tag === "二级结论")).toHaveLength(1)
  })

  it("puts the subject's own vocabulary first, strays after", () => {
    // The three you reach for daily should not move because an old tag exists.
    expect(tagOptionsFor("all", ["考点"]).slice(0, 3)).toEqual([...SHARED_INSIGHT_TAGS])
  })
})
