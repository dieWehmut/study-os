import { expect, test } from "@playwright/test"

test("renders deep links from static fixtures without a backend", async ({ page }) => {
  const apiRequests: string[] = []
  const runtimeErrors: string[] = []
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (/\/api(?:\/|$)/.test(pathname)) apiRequests.push(request.url())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))

  for (const route of ["#", "#/knowledge", "#/memory", "#/chat", "#/integrate", "#/settings", "#/practice", "#/import", "#/reading/articles"]) {
    await page.goto(route)
    await expect(page.locator("main")).toBeVisible()
  }

  await expect(page.locator('[data-static-demo="true"]')).toBeVisible()
  await expect(page.locator("main")).toContainText("Memory")
  expect(apiRequests).toEqual([])
  expect(runtimeErrors).toEqual([])
})
