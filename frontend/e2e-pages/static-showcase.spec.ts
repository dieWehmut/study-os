import { expect, test } from "@playwright/test"

test("renders deep links from static fixtures without a backend", async ({ page }) => {
  const apiRequests: string[] = []
  const runtimeErrors: string[] = []
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (/\/api(?:\/|$)/.test(pathname)) apiRequests.push(request.url())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))

  for (const route of ["#", "#/knowledge", "#/memory", "#/chat", "#/integrate", "#/settings", "#/practice", "#/import", "#/reading/articles", "#/lessons", "#/lessons/lesson-newton"]) {
    await page.goto(route)
    await expect(page.locator("main")).toBeVisible()
  }

  await page.goto("#/memory")
  await expect(page.locator("main")).toContainText("\u8bb0\u5fc6\u68c0\u6d4b")

  await page.goto("#/lessons")
  await expect(page.locator("main")).toContainText("\u725b\u987f\u7b2c\u4e8c\u5b9a\u5f8b\uff1a\u4ece\u53d7\u529b\u56fe\u5f00\u59cb")

  await page.goto("#/lessons/lesson-newton")
  await expect(page.locator("main")).toContainText("\u725b\u987f\u7b2c\u4e8c\u5b9a\u5f8b\uff1a\u4ece\u53d7\u529b\u56fe\u5f00\u59cb")
  const practice = page.locator("[data-section-kind='practice']")
  await practice.getByRole("radio", { name: "8 N" }).check()
  await practice.getByRole("button", { name: "\u63d0\u4ea4\u7b54\u6848" }).click()
  await expect(practice.getByRole("status")).toContainText("\u56de\u7b54\u6b63\u786e")
  await expect(practice.getByText("\u5df2\u4fdd\u5b58\u7b54\u9898\u8bc1\u636e")).toBeVisible()

  // Keep the document alive while switching hash routes so the in-memory
  // Pages adapter can prove that a saved attempt is visible on revisit.
  await page.evaluate(() => {
    window.location.hash = "#/lessons"
  })
  await expect(page.locator("main")).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = "#/lessons/lesson-newton"
  })
  const reopenedPractice = page.locator("[data-section-kind='practice']")
  await expect(reopenedPractice).toHaveAttribute("data-practice-history", "ready")
  await expect(reopenedPractice.getByText(/\u5df2\u4f5c\u7b54\s*1\s*\u6b21/)).toBeVisible()
  await expect(reopenedPractice.getByRole("status")).toContainText("\u56de\u7b54\u6b63\u786e")

  await page.evaluate(() => {
    window.location.hash = "#/practice"
  })
  const mistakeRow = page.getByRole("listitem").filter({ hasText: "I used the wrong sign in F = ma." })
  await mistakeRow.getByRole("button", { name: "\u8ba2\u6b63", exact: true }).click()
  await mistakeRow.getByLabel("\u8ba2\u6b63\u7b54\u6848").fill("6 N")
  await mistakeRow.getByRole("button", { name: "\u63d0\u4ea4\u8ba2\u6b63" }).click()
  await expect(mistakeRow.getByText("\u5df2\u8ba2\u6b63", { exact: true })).toBeVisible()
  await expect(mistakeRow).toContainText("\u7b54\u6848\uff1a6 N")

  await page.evaluate(() => {
    window.location.hash = "#/knowledge"
  })
  await expect(page.locator("main")).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = "#/practice"
  })
  const reopenedMistake = page.getByRole("listitem").filter({ hasText: "I used the wrong sign in F = ma." })
  await expect(reopenedMistake).toContainText("\u7b54\u6848\uff1a6 N")

  await expect(page.locator('[data-static-demo="true"]')).toBeVisible()
  expect(apiRequests).toEqual([])
  expect(runtimeErrors).toEqual([])
})
