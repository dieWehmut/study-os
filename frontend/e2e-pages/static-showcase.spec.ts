import { expect, test } from "@playwright/test"

// Reading the clipboard back is the only way to check what a 复制链接 button really
// put there; the page itself needs the permission for that.
test.use({ permissions: ["clipboard-read", "clipboard-write"] })

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

  // What this build can and cannot offer, on the routes that carry an export.
  // The library's CSV needs the local database, so the demo leaves the button
  // out -- it has knowledge items to list, so its absence is a decision and not
  // an empty page.
  await page.goto("#/knowledge")
  await expect(page.locator("main")).toBeVisible()
  await expect(page.getByRole("button", { name: "\u5bfc\u51fa CSV" })).toHaveCount(0)

  // The 错题本 export is the same kind of button and had been left unguarded: the
  // demo lists mistakes, so this one would have been visible and always failing.
  await page.goto("#/practice")
  await expect(page.getByRole("listitem").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "\u5bfc\u51fa CSV" })).toHaveCount(0)

  // Every backup action needs the local database, so none of them is offered here
  // -- including 立即备份, which the header renders whenever the page does. The row
  // buttons below it are vacuous in this build (the demo keeps no backup records),
  // so they are asserted only to catch a future fixture that adds one.
  await page.goto("#/settings")
  await expect(page.locator("main")).toContainText("\u5907\u4efd\u8bb0\u5f55")
  await expect(page.getByRole("button", { name: "\u7acb\u5373\u5907\u4efd" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "\u6821\u9a8c" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "\u4e0b\u8f7d", exact: true })).toHaveCount(0)

  // Copying a link is client-side and works here -- and this build keeps the route
  // inside the hash, which is the branch a link written from window.location gets
  // wrong: it would land on the site root with the item missing.
  await page.goto("#/knowledge")
  await expect(page.locator("main")).toBeVisible()
  const copyLink = page.getByRole("button", { name: "\u590d\u5236\u94fe\u63a5" }).first()
  await expect(copyLink).toBeVisible()
  await copyLink.click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  console.log("DEMO COPIED", copied)
  expect(copied).toContain("#/knowledge?item=")
  expect(copied).not.toMatch(/\/#?knowledge\?item=.*#\/knowledge/)

  // The course export is pure client-side, so it works here too.
  await page.goto("#/lessons/lesson-newton")
  await expect(page.locator("main")).toContainText("\u725b\u987f\u7b2c\u4e8c\u5b9a\u5f8b\uff1a\u4ece\u53d7\u529b\u56fe\u5f00\u59cb")
  const markdown = page.waitForEvent("download")
  await page.getByRole("button", { name: "\u5bfc\u51fa Markdown" }).click()
  expect((await markdown).suggestedFilename()).toMatch(/\.md$/)

  expect(apiRequests).toEqual([])
  expect(runtimeErrors).toEqual([])
})
