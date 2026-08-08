import { describe, expect, it } from "vitest"

import { chunkMarkdown } from "./chunk"

describe("reading chunker", () => {
  it("breaks at headings so a chunk is one place you can stop", () => {
    const chunks = chunkMarkdown(["# 光合作用", "## 光反应", "在类囊体上。", "## 暗反应", "在基质中。"].join("\n"))

    expect(chunks.map((chunk) => chunk.title)).toEqual(["光反应", "暗反应"])
    expect(chunks[0].lines).toEqual(["在类囊体上。"])
  })

  it("carries the heading path so a chunk is readable out of context", () => {
    // The focus reader shows one chunk alone. Without the path above it, a
    // learner cannot tell which section they are in -- which is precisely the
    // working-memory load the reader exists to remove.
    const chunks = chunkMarkdown(["# 生物", "## 光合作用", "### 光反应", "在类囊体上。"].join("\n"))

    expect(chunks[0].path).toEqual(["生物", "光合作用", "光反应"])
  })

  it("absorbs list items into the section that contains them", () => {
    const chunks = chunkMarkdown(["# 标题", "## 条件", "- 光照", "- 温度"].join("\n"))

    expect(chunks).toHaveLength(1)
    expect(chunks[0].lines).toEqual(["光照", "温度"])
  })

  it("splits a section that overruns the budget, and never mid-line", () => {
    const long = "一".repeat(40)
    const chunks = chunkMarkdown(["# 标题", "## 长节", long, long, long].join("\n"), { budget: 90 })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.lines.every((line) => line === long))).toBe(true)
    expect(chunks.flatMap((chunk) => chunk.lines)).toHaveLength(3)
  })

  it("marks a continued section so the reader can say 接上页", () => {
    const long = "一".repeat(40)
    const chunks = chunkMarkdown(["# 标题", "## 长节", long, long].join("\n"), { budget: 50 })

    expect(chunks[0].continues).toBe(false)
    expect(chunks[1].continues).toBe(true)
    expect(chunks[1].title).toBe("长节")
  })

  it("previews each chunk with its first sentence, not a model summary", () => {
    // Deterministic on purpose: the gist must be the same every time the same
    // source is opened, or the preview stops being something to rely on.
    const chunks = chunkMarkdown(["# 标题", "## 小节", "第一句话。第二句话。"].join("\n"))

    expect(chunks[0].gist).toBe("第一句话。")
  })

  it("skips a heading that only groups other headings", () => {
    // An empty parent would be a chunk with nothing to read in it.
    const chunks = chunkMarkdown(["# 标题", "## 分组", "### 有内容", "正文。"].join("\n"))

    expect(chunks.map((chunk) => chunk.title)).toEqual(["有内容"])
  })

  it("keeps prose that arrives before any heading", () => {
    const chunks = chunkMarkdown("开头这段没有标题。", { title: "未命名" })

    expect(chunks).toHaveLength(1)
    expect(chunks[0].lines).toEqual(["开头这段没有标题。"])
    expect(chunks[0].title).toBe("未命名")
  })

  it("reports its own size so the preview can show how heavy a chunk is", () => {
    const chunks = chunkMarkdown(["# 标题", "## 小节", "1234567890"].join("\n"))

    expect(chunks[0].size).toBe(10)
  })

  it("returns nothing for an empty document rather than one empty chunk", () => {
    expect(chunkMarkdown("   \n\n  ")).toEqual([])
  })
})
