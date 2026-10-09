import { expect, test } from "@playwright/test"

// A 学习记录 is the one place where "what I now understand" gets written down.
// Until this spec existed, saving one linked to a knowledge point changed
// nothing else in the app: the record sat beside the queue it was implicitly
// about. This walks the whole loop against the real backend -- file a point in
// the 暂存 box (filing does not schedule it), ask about it, link the record to
// it, press 排进复习, and confirm the card is really there afterwards.
test("returns a learning record's knowledge point to the review queue", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name === "mobile-chromium" ? "-mobile" : ""
  const term = `regrow${suffix}`

  // Imported words arrive already scheduled, so the 暂存 box is the only way to
  // hand this spec a knowledge point that has no cards yet -- which is exactly
  // the state 回流 exists for.
  await page.goto("/")
  await page.getByLabel("脑暴收集箱").fill(term)
  await page.getByRole("button", { name: "暂存", exact: true }).click()
  await expect(page.getByText("已暂存到知识库，稍后可以整理。")).toBeVisible({ timeout: 15_000 })

  await page.goto("/chat")
  await page.getByLabel("发给 AI 的消息").fill(`${term} 是什么意思？`)
  await page.getByRole("button", { name: "发送" }).click()

  // The 学习记录 panel only exists once the background answer has landed.
  const save = page.getByRole("button", { name: "保存记录" })
  await expect(save).toBeVisible({ timeout: 60_000 })
  await page.getByLabel("关联对象").selectOption({ label: `知识点：${term}` })
  await save.click()

  const flowBack = page.getByRole("region", { name: "回流到复习计划" })
  await expect(flowBack).toBeVisible({ timeout: 15_000 })
  // Linking is not queueing: the button has to be there before anything is scheduled.
  const queue = flowBack.getByRole("button", { name: "排进复习" })
  await expect(queue).toBeEnabled()
  await queue.click()

  // The count comes from the server, so this text is proof the card was written.
  await expect(flowBack.getByRole("status")).toHaveText(/已排进复习 · \d+ 张卡/, { timeout: 15_000 })
  await expect(flowBack.getByRole("button", { name: "排进复习" })).toHaveCount(0)

  // And it survives leaving the page: the item the record pointed at now
  // carries review cards, which is the same state 排进复习 leaves everywhere.
  await page.goto("/knowledge")
  await page.getByRole("button", { name: new RegExp(term) }).click()
  await expect(page.getByRole("heading", { name: term })).toBeVisible()
  await expect(page.getByRole("button", { name: /已排进复习/ })).toBeDisabled()
})