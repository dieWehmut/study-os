import { beforeEach, describe, expect, it } from "vitest"

import { chunkMarkdown } from "./chunk"
import { askDraftStorageKey, buildStuckQuestion, putAskDraft, takeAskDraft } from "./ask-draft"

const source = [
  "# 光合作用",
  "## 光反应",
  "在类囊体薄膜上进行。产物是 ATP 和 NADPH。",
  "## 暗反应",
  "在叶绿体基质中进行。",
].join("\n")

const chunks = chunkMarkdown(source)

describe("turning what you got stuck on into a question", () => {
  it("has nothing to ask when nothing is stuck", () => {
    expect(buildStuckQuestion([])).toBe("")
  })

  it("carries the section's own words, not only its heading", () => {
    // Whoever answers never saw the document. A heading on its own is a title
    // with no text under it -- unanswerable.
    const question = buildStuckQuestion([chunks[0]])

    expect(question).toContain("在类囊体薄膜上进行。产物是 ATP 和 NADPH。")
  })

  it("says where the section sits, not only what it is called", () => {
    // The same reason the reader keeps the heading path above the prose: a
    // section read out of its document is just a sentence.
    const question = buildStuckQuestion([chunks[0]])

    expect(question).toContain("光合作用 / 光反应")
  })

  it("carries every stuck section, because the gap is the whole set", () => {
    const question = buildStuckQuestion(chunks)

    expect(question).toContain("光反应")
    expect(question).toContain("暗反应")
    expect(question).toContain("在叶绿体基质中进行。")
  })

  it("says what is being asked, rather than dumping the sections", () => {
    const question = buildStuckQuestion([chunks[0]])

    expect(question).toMatch(/没看懂/)
  })
})

describe("carrying a question to 答疑", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("has nothing waiting when no question was left", () => {
    expect(takeAskDraft()).toBe("")
  })

  it("hands over the question that was left", () => {
    putAskDraft("这一节没看懂")

    expect(takeAskDraft()).toBe("这一节没看懂")
  })

  it("hands a question over once, because taking it is not peeking at it", () => {
    // The draft is a handoff, not a store. One that survived being read would
    // turn up weeks later on an unrelated visit to 答疑.
    putAskDraft("这一节没看懂")
    takeAskDraft()

    expect(takeAskDraft()).toBe("")
  })

  it("treats a blank question as nothing to carry", () => {
    putAskDraft("这一节没看懂")
    putAskDraft("   ")

    expect(localStorage.getItem(askDraftStorageKey)).toBeNull()
  })
})
