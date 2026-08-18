import { expect, test } from "@playwright/test"

test("renders deep links from static fixtures without a backend", async ({ page }) => {
  const apiRequests: string[] = []
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith("/api/") || pathname.startsWith("/study-os/api/")) apiRequests.push(request.url())
  })

  await page.goto("#/")
  await expect(page.locator('[data-static-demo="true"]')).toBeVisible()
  await expect(page.locator("main")).toBeVisible()

  await page.goto("#/knowledge")
  await expect(page.locator("main")).toContainText("last")

  await page.goto("#/reading/articles")
  await expect(page.locator("main")).toContainText("Memory")

  expect(apiRequests).toEqual([])
})
