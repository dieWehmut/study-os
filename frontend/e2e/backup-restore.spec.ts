import { expect, test } from "@playwright/test"

// A restore cannot run while the app is open, so this covers the half a browser
// can reach: scheduling one from the settings page, seeing that it is waiting for
// the next start, and taking it back. The restart itself is covered where it
// happens -- a Go test builds a second application over the same data directory,
// which is exactly what a restart is.
test("schedules a restore, says so, and can take it back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  // Something to back up, taken through the app's own endpoint.
  await page.request.post("/api/dump", { data: { text: "恢复验收\n\n这份备份里应该有这条。" } })
  const created = await page.request.post("/api/backups", { data: { category: "daily" } })
  expect(created.status()).toBe(201)

  await page.goto("/settings")
  await expect(page.getByText("备份记录")).toBeVisible()

  // Two presses on the same row: this is the one action here that throws data
  // away, so the first press only arms it.
  await page.getByRole("button", { name: "恢复" }).first().click()
  const confirm = page.getByRole("button", { name: "确认恢复这一份" })
  await expect(confirm).toBeVisible()
  await confirm.click()

  const banner = page.getByText(/已安排恢复/)
  await expect(banner).toBeVisible()
  await expect(banner).toContainText("下次启动")

  // And the reader can change their mind before that start happens.
  await page.getByRole("button", { name: "取消安排" }).click()
  await expect(page.getByText(/已安排恢复/)).toHaveCount(0)

  await page.goto("/settings")
  await expect(page.getByText(/已安排恢复/)).toHaveCount(0)
})