import { describe, expect, it } from "vitest"

import { renameOutlineLine } from "./wiki-edit"

describe("renameOutlineLine", () => {
  it("replaces a heading's words and keeps its level", () => {
    const source = ["# 光合作用", "", "## 光反应", "发生在类囊体薄膜。"].join("\n")

    expect(renameOutlineLine(source, 2, "光反应阶段")).toBe(
      ["# 光合作用", "", "## 光反应阶段", "发生在类囊体薄膜。"].join("\n"),
    )
  })

  it("leaves every other line byte-for-byte alone", () => {
    // The reason a rename addresses one line instead of rebuilding the document
    // from the tree. The parser models headings, list items and prose; it does
    // not model blank lines, trailing spaces, code fences or tables, and a
    // regenerated document would quietly launder all of them.
    const source = ["# 甲", "", "```py", "x = 1  ", "```", "", "## 乙", "| a | b |"].join("\n")

    const renamed = renameOutlineLine(source, 6, "丙")

    // `renameOutlineLine` answers null for a refusal; a rename of a heading
    // never refuses, and the typechecker cannot see that.
    expect(renamed).not.toBeNull()
    expect(renamed!.split("\n")).toEqual(["# 甲", "", "```py", "x = 1  ", "```", "", "## 丙", "| a | b |"])
  })

  it("keeps a list item's marker and indentation", () => {
    // Indentation is what the parser reads depth from, so losing it would
    // reparent the node the reader just renamed.
    const source = ["# 甲", "- 光照", "  - 强度", "1. 顺序项"].join("\n")

    expect(renameOutlineLine(source, 2, "光强")).toBe(
      ["# 甲", "- 光照", "  - 强度".replace("强度", "光强"), "1. 顺序项"].join("\n"),
    )
    expect(renameOutlineLine(source, 3, "第一步")).toBe(
      ["# 甲", "- 光照", "  - 强度", "1. 第一步"].join("\n"),
    )
  })

  it("renames a split item's subject and keeps the explanation it carries", () => {
    // A long 「主题：说明」 item draws as the subject alone, with the explanation in
    // the note. So the rename is handed only the subject, and the words after the
    // colon are the author's prose -- writing the label over the whole line would
    // silently delete a sentence the reader never saw in the editor.
    const source = ["## 结构", "- 轨道式：多实体加强弱排序与动态反馈，主体横行居中关系弧上下环绕"].join("\n")

    expect(renameOutlineLine(source, 1, "环绕式")).toBe(
      ["## 结构", "- 环绕式：多实体加强弱排序与动态反馈，主体横行居中关系弧上下环绕"].join("\n"),
    )
  })

  it("rewrites a short item whole, since that is all the map drew", () => {
    // The mirror case. 「接口：render()」 fits, so the map drew the colon too and
    // the reader edited the whole thing -- keeping the old tail would append it.
    const source = ["- 接口：render(kernel)"].join("\n")

    expect(renameOutlineLine(source, 0, "入口：main()")).toBe("- 入口：main()")
  })

  it("refuses a line that is not a heading or a list item", () => {
    // Prose carries no title, so there is nothing on it a rename could mean.
    // Rewriting it anyway would replace a whole sentence with a node label.
    const source = ["# 甲", "这是正文。"].join("\n")

    expect(renameOutlineLine(source, 1, "乙")).toBeNull()
  })

  it("refuses a line outside the document", () => {
    // The map is re-derived from markdown that another tab may have just
    // replaced, so a stale line number is reachable rather than impossible.
    expect(renameOutlineLine("# 甲", -1, "乙")).toBeNull()
    expect(renameOutlineLine("# 甲", 9, "乙")).toBeNull()
  })

  it("refuses a blank title", () => {
    // An empty heading parses as no heading, so the node would vanish from the
    // map along with everything nested under it.
    expect(renameOutlineLine("# 甲\n## 乙", 1, "   ")).toBeNull()
  })

  it("refuses a title that would restructure the document", () => {
    // A title containing a newline splits one node into two, and one opening
    // with "#" changes the heading level of everything after it. Both are
    // edits the reader did not ask for while typing a name.
    expect(renameOutlineLine("# 甲\n## 乙", 1, "丙\n### 丁")).toBeNull()
    expect(renameOutlineLine("# 甲\n## 乙", 1, "# 丙")).toBeNull()
  })

  it("trims the title, because a trailing space is invisible in the map", () => {
    expect(renameOutlineLine("# 甲\n## 乙", 1, "  丙  ")).toBe("# 甲\n## 丙")
  })

  it("rewrites a table row's first cell and leaves its other columns alone", () => {
    // A row is a node like any other, so the map offers the same ✎ on it. If
    // the write refused, that pencil would be a control that always fails --
    // the label it edits is the first cell, so that is what a rename means.
    const source = ["| 概念 | 定义 |", "| --- | --- |", "| 动量 | mv |"].join("\n")

    expect(renameOutlineLine(source, 2, "线动量")).toBe(
      ["| 概念 | 定义 |", "| --- | --- |", "| 线动量 | mv |"].join("\n"),
    )
  })

  it("keeps a row's own pipe style", () => {
    // GFM makes the outer pipes optional and the parser reads both. Rewriting
    // one form into the other would edit a line the reader did not touch.
    const source = ["概念 | 定义", "--- | ---", "动量 | mv"].join("\n")

    expect(renameOutlineLine(source, 2, "线动量")).toBe(
      ["概念 | 定义", "--- | ---", "线动量 | mv"].join("\n"),
    )
  })

  it("escapes a bar typed into a title, instead of splitting the row", () => {
    // An unescaped bar in the first cell would silently become a new column and
    // push every value after it under the wrong header.
    const source = ["| 概念 | 定义 |", "| --- | --- |", "| 动量 | mv |"].join("\n")

    expect(renameOutlineLine(source, 2, "|p| 大小")).toBe(
      ["| 概念 | 定义 |", "| --- | --- |", "| \\|p\\| 大小 | mv |"].join("\n"),
    )
  })

  it("refuses to rename the row that holds the table together", () => {
    // The alignment row is punctuation and the header names every field below
    // it; neither is a node, so neither can be reached from the map. Refusing
    // here is belt-and-braces against a stale line number landing on one.
    const source = ["| 概念 | 定义 |", "| --- | --- |", "| 动量 | mv |"].join("\n")

    expect(renameOutlineLine(source, 1, "甲")).toBeNull()
  })
})
