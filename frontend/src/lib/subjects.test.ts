import { describe, expect, it } from "vitest"

import { subjectName } from "./subjects"

describe("subjectName", () => {
  it("names the six subjects", () => {
    expect(subjectName("physics")).toBe("物理")
  })

  it("calls 综合 by its name rather than by its id", () => {
    // "all" reaches these pages as a stored value: a lesson made from a 综合 note
    // has no subject of its own, and "all" is not a name to show a reader.
    expect(subjectName("all")).toBe("综合")
  })

  it("falls back to the raw id for anything it does not know", () => {
    expect(subjectName("astronomy")).toBe("astronomy")
  })
})