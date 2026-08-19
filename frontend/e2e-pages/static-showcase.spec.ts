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
  await expect(page.locator("main")).toContainText("记忆检测")

  await page.goto("#/lessons")
  await expect(page.locator("main")).toContainText("牛顿第二定律：从受力图开始")

  await page.goto("#/lessons/lesson-newton")
  await expect(page.locator("main")).toContainText("牛顿第二定律：从受力图开始")
  const practice = page.locator("[data-section-kind='practice']")
  await practice.getByRole("radio", { name: "8 N" }).check()
  await practice.getByRole("button", { name: "提交答案" }).click()
  await expect(practice.getByRole("status")).toContainText("回答正确")

  await expect(page.locator('[data-static-demo="true"]')).toBeVisible()
  expect(apiRequests).toEqual([])
  expect(runtimeErrors).toEqual([])
})
