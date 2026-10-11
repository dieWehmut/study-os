import { expect, test } from "@playwright/test"

// The 错因 filter, end to end: the dropdown narrows the list, the total narrows with
// it, and the file the reader exports means the same thing as the screen.
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

  // And the same narrowing through the page, which is what a reader actually does.
  await page.goto("/practice")
  await expect(page.getByRole("listitem").filter({ hasText: "看错条件的题" }).first()).toBeVisible({ timeout: 15_000 })

  await page.getByRole("combobox", { name: "按错因筛选" }).click()
  // The label of `method` in the taxonomy, read from the app rather than guessed:
  // an option name that does not exist simply waits, which is how the first version
  // of this test failed against a filter that worked.
  await page.getByRole("option", { name: "思路不对" }).click()

  await expect(page.getByText(/只显示「思路不对」的错题/)).toBeVisible()
  await expect(page.getByRole("listitem").filter({ hasText: "方法用错的题" }).first()).toBeVisible()
  await expect(page.getByRole("listitem").filter({ hasText: "看错条件的题" })).toHaveCount(0)
})