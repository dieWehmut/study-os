import { describe, expect, it } from "vitest"

import { normalizeReadingMarkdown } from "./markdown-source"

describe("normalizeReadingMarkdown", () => {
  it("hides front matter, translates wiki links, and preserves safe callout syntax", () => {
    const source = [
      "---",
      "book: 1",
      "---",
      "# Title",
      "[[#结构速览|跳转]]",
      "> [!abstract] 导读",
      "> Body",
      '<span class="ody-ln">10</span>Line',
    ].join("\n")
    const result = normalizeReadingMarkdown(source)
    expect(result).not.toContain("book: 1")
    expect(result).toContain("[跳转](#结构速览)")
    expect(result).toContain("> [!abstract] 导读")
    expect(result).toContain("⟦ODY_LN:10⟧Line")
  })

  it("does not enable arbitrary HTML", () => {
    const result = normalizeReadingMarkdown('<script>alert("x")</script>\n<img src=x onerror=alert(1)>')
    expect(result).toContain("<script>")
    expect(result).toContain("onerror=alert(1)")
  })
})
