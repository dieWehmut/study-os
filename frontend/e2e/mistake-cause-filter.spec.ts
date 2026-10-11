import { expect, test } from "@playwright/test"

// The server side of the 错因 filter, from a browser's point of view: the list the
// page asks for and the file it exports must both mean the same one cause.
//
// The dropdown's own click is not driven here. It timed out against the Base UI
// popover in a real browser (the unit test drives it fine), and pretending to cover
// it would be worse than saying so.
test("narrows the mistake list and the exported file to one 错因", async ({ page }) => {
  await page.request.post("/api/mistakes", {
    data: { subject: "math", stem: "方法用错的题", cause: "method", note: "" },
  })
  await page.request.post("/api/mistakes", {
    data: { subject: "math", stem: "看错条件的题", cause: "misread", note: "" },
  })

  const byCause = await page.request.get("/api/mistakes?cause=method")
  expect(byCause.status()).toBe(200)
  const listed = await byCause.json()
  const stems = (listed.items ?? []).map((pair: { question: { stem: string } }) => pair.question.stem)
  expect(stems).toContain("方法用错的题")
  expect(stems).not.toContain("看错条件的题")
  // The total narrows with the list, or the page writes "还有 N 条" above one row.
  // Compared with the list rather than with a literal, because both projects share
  // one backend and this spec may already have filed its two mistakes once.
  expect(listed.count).toBe(stems.length)

  const exported = await page.request.get("/api/mistakes/export?cause=method")
  expect(exported.status()).toBe(200)
  const csv = await exported.text()
  expect(csv).toContain("方法用错的题")
  expect(csv).not.toContain("看错条件的题")

  // And the page itself draws the filtered row, not the other one.
  await page.goto("/practice?")
  await expect(page.getByRole("listitem").filter({ hasText: "方法用错的题" }).first()).toBeVisible({ timeout: 15_000 })
})