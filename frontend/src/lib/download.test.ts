import { afterEach, describe, expect, it, vi } from "vitest"

import { saveBlobFile, saveTextFile } from "./download"

/** Watch what the anchor looks like at the moment it is clicked. */
function captureClick() {
  const seen: { inDocument: boolean; download: string; href: string; rel: string }[] = []
  const original = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    seen.push({
      inDocument: document.body.contains(this),
      download: this.download,
      href: this.href,
      rel: this.rel,
    })
  }
  return { seen, restore: () => { HTMLAnchorElement.prototype.click = original } }
}

describe("saveBlobFile", () => {
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL

  afterEach(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })

  it("clicks a link that is part of the page, then cleans it up", () => {
    // A detached anchor is not required to download: `download` is honoured for a
    // link in the document, so the exports would silently do nothing without this.
    URL.createObjectURL = vi.fn(() => "blob:export") as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    const { seen, restore } = captureClick()
    try {
      saveBlobFile(new Blob(["a,b\n1,2\n"], { type: "text/csv" }), "study-os.csv")

      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ inDocument: true, download: "study-os.csv", href: "blob:export", rel: "noopener" })
      // Removed and revoked: no invisible anchor or held blob per export.
      expect(document.querySelectorAll("a[download]")).toHaveLength(0)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export")
    } finally {
      restore()
    }
  })

  it("still revokes the URL when the click throws", () => {
    // Otherwise a failed click leaks the file for the life of the page.
    URL.createObjectURL = vi.fn(() => "blob:doomed") as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    const original = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = () => {
      throw new Error("blocked")
    }
    try {
      expect(() => saveBlobFile(new Blob(["x"]), "x.txt")).toThrow("blocked")
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:doomed")
      expect(document.querySelectorAll("a[download]")).toHaveLength(0)
    } finally {
      HTMLAnchorElement.prototype.click = original
    }
  })

  it("wraps text in a blob of the type it was given", () => {
    URL.createObjectURL = vi.fn(() => "blob:text") as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    const { seen, restore } = captureClick()
    try {
      saveTextFile("# 课程\n\n正文\n", "课程.md", "text/markdown;charset=utf-8")

      const blob = (URL.createObjectURL as unknown as { mock: { calls: Blob[][] } }).mock.calls[0][0]
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe("text/markdown;charset=utf-8")
      expect(seen[0].download).toBe("课程.md")
    } finally {
      restore()
    }
  })
})