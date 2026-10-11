import { expect, test } from "@playwright/test"

// 排进复习 与 取消排复习，走一遍真正的界面。
//
// The undo shipped with unit tests and Go tests but nothing that had ever pressed the
// two buttons in a browser and then asked the queue whether the item was really gone.
test("takes an item out of the review queue from the panel, and puts it back", async ({ page }) => {
  // A marker of its own per run: both projects share one backend, and the desktop run
  // leaves its copy scheduled on purpose (the last step puts it back). Asserting on a
  // fixed sentence made mobile fail on the desktop's row.
  const marker = `端到端${Date.now()}`
  const dumped = await page.request.post("/api/dump", { data: { text: `${marker} / 来回都要行` } })
  expect(dumped.status()).toBe(201)
  const item = await dumped.json()
  const id: string = item.id
  expect(id).toBeTruthy()

  await page.goto(`/knowledge?item=${encodeURIComponent(id)}`)
  const queueButton = page.getByRole("button", { name: "排进复习", exact: true })
  await expect(queueButton).toBeVisible({ timeout: 15_000 })

  await queueButton.click()
  await expect(page.getByText(/已排进复习 · \d+ 张卡/)).toBeVisible()
  const dueAfterSchedule = await page.request.get("/api/reviews/due?limit=50")
  expect(await dueAfterSchedule.text()).toContain(marker)

  // The undo sits next to it, and answers without a page reload.
  const cancelButton = page.getByRole("button", { name: "取消排复习", exact: true })
  await expect(cancelButton).toBeVisible()
  await cancelButton.click()
  await expect(page.getByText(/已取消复习安排 · 移出 \d+ 张卡/)).toBeVisible()
  await expect(page.getByRole("button", { name: "排进复习", exact: true })).toBeVisible()

  const dueAfterUndo = await page.request.get("/api/reviews/due?limit=50")
  expect(await dueAfterUndo.text()).not.toContain(marker)

  // And it can come back -- the cards were left standing precisely so this works.
  await page.getByRole("button", { name: "排进复习", exact: true }).click()
  await expect(page.getByText(/已排进复习 · \d+ 张卡/)).toBeVisible()
  const dueAgain = await page.request.get("/api/reviews/due?limit=50")
  expect(await dueAgain.text()).toContain(marker)
})