import { describe, expect, it } from "vitest"

import { formatDay, formatShortDay, formatStamp } from "./dates"

describe("date helpers", () => {
  it("leaves a plain date alone and formats a timestamp", () => {
    // Rows carry both shapes. Rendering the first through Intl would turn 2026-08-22
    // into 2026/08/22 in one column and not the other.
    expect(formatDay("2026-08-22")).toBe("2026-08-22")
    expect(formatDay("2026-08-22T10:00:00Z")).toMatch(/2026/)
    expect(formatDay(undefined)).toBe("日期未填写")
    // Unparseable input is handed back rather than replaced by "Invalid Date".
    expect(formatDay("不是日期")).toBe("不是日期")
  })

  it("shortens to month and day, and stays silent without one", () => {
    expect(formatShortDay("2026-08-22T10:00:00Z")).toMatch(/\d/)
    expect(formatShortDay(undefined)).toBe("")
    expect(formatShortDay("不是日期")).toBe("不是日期")
  })

  it("keeps the time for the places where the moment matters", () => {
    // A backup file and an import run want the clock; a list of things to read does
    // not. Empty reads as empty, so the caller can say what "nothing" means there.
    expect(formatStamp("2026-08-22T10:00:00Z")).toMatch(/2026/)
    expect(formatStamp("2026-08-22T10:00:00Z").length).toBeGreaterThan(formatDay("2026-08-22T10:00:00Z").length)
    expect(formatStamp(undefined)).toBe("")
    expect(formatStamp("不是日期")).toBe("不是日期")
  })
})