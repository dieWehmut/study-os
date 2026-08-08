import { describe, expect, it } from "vitest"

import { chunkMarkdown } from "./chunk"
import { buildSectionNote } from "./reading-note"

const source = ["# 光合作用", "## 光反应", "在类囊体薄膜上进行。", "产物是 ATP 和 NADPH。"].join("\n")

describe("keeping a section you understood", () => {
  it("leads with where the section sits, because that becomes its name", () => {
    // The store takes the first 40 characters of whatever it is sent as the
    // item's term. Led by the prose, the library fills up with items called
    // "在类囊体薄膜上进行。" -- sentences wearing a title's clothes.
    const [chunk] = chunkMarkdown(source)

    expect(buildSectionNote(chunk).startsWith("光合作用 / 光反应")).toBe(true)
  })

  it("carries the section's own words, not only its heading", () => {
    // A heading with nothing under it is a title for something you can no
    // longer read, which is worth less than not keeping it at all.
    const [chunk] = chunkMarkdown(source)

    const note = buildSectionNote(chunk)
    expect(note).toContain("在类囊体薄膜上进行。")
    expect(note).toContain("产物是 ATP 和 NADPH。")
  })

  it("names a section at the root of the document by itself", () => {
    // A one-heading document has no path to speak of, and "光合作用 / 光合作用"
    // reads like a bug.
    const [chunk] = chunkMarkdown(["# 光合作用", "把光能变成化学能。"].join("\n"))

    expect(buildSectionNote(chunk).startsWith("光合作用\n")).toBe(true)
  })
})
