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
})
