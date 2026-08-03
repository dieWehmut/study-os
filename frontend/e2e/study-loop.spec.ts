import { expect, test, type Page } from "@playwright/test"

async function answerCurrentPrompt(page: Page) {
  const modeBadge = page.locator("main").getByText(/看英文，说中文|看中文，说英文|语境填空/).first()
  await expect(modeBadge).toBeVisible()
  const mode = (await modeBadge.textContent()) ?? ""
  const expected = mode.includes("看英文") ? "放弃；抛弃" : "abandon"

  await page.getByLabel("你的答案").fill(expected)
  await page.getByRole("button", { name: "提交答案" }).click()
  await expect(page.getByText(/正确|部分正确|需要重学/).first()).toBeVisible()
  await page.getByRole("button", { name: "改判为掌握" }).click()
  await expect(page.getByText(/系统他评 · 良好/)).toBeVisible()
  await page.getByRole("button", { name: "下一题" }).click()
}

async function currentProgress(page: Page): Promise<number> {
  const progress = page.locator("main").getByText(/^1 \/ \d+$/)
  await expect(progress).toBeVisible()
  const count = Number((await progress.textContent())?.split("/")[1]?.trim())
  expect(Number.isFinite(count)).toBe(true)
  return count
}

test("imports a fixture, reviews it, corrects a rating, and persists across reloads", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => consoleErrors.push(error.message))

  const suffix = testInfo.project.name === "mobile-chromium" ? "-mobile" : ""
  const term = `abandon${suffix}`
  const secondTerm = `serendipity${suffix}`
  const fixtureRows = [
    "term,definition,example",
    `${term},放弃；抛弃,They abandoned the project.`,
    `${secondTerm},意外发现美好事物的运气,Meeting her was pure serendipity.`,
  ].join("\n")

  await page.goto("/import")

  await page.setInputFiles('input[type="file"]', {
    name: "words.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(fixtureRows, "utf-8"),
  })
  await page.getByRole("button", { name: "上传文件" }).click()
  await page.getByLabel("单词 源列").selectOption("term")
  await page.getByLabel("释义 源列").selectOption("definition")
  await page.getByLabel("例句 源列").selectOption("example")
  await page.getByRole("button", { name: "预览导入" }).click()
  await page.getByRole("button", { name: "提交导入" }).click()
  await expect(page.getByText(/已导入 2 条知识点/)).toBeVisible({ timeout: 15_000 })

  await page.goto("/knowledge")
  await expect(page.getByRole("heading", { name: term })).toBeVisible()
  await expect(page.getByText("放弃;抛弃").first()).toBeVisible()
  await expect(page.getByText("They abandoned the project.").first()).toBeVisible()

  await page.goto("/memory")
  await expect(page.locator("main h1")).toBeVisible({ timeout: 15_000 })
  const dueBefore = await currentProgress(page)
  const firstQuestion = (await page.locator("main h1").textContent())?.trim() ?? ""
  await answerCurrentPrompt(page)

  await page.reload()
  await expect(page.locator("main h1")).toBeVisible()
  const dueAfter = await currentProgress(page)
  expect(dueAfter).toBe(dueBefore - 1)
  expect((await page.locator("main h1").textContent())?.trim()).not.toBe(firstQuestion)

  await page.goto("/knowledge")
  await page.getByRole("button", { name: new RegExp(secondTerm) }).click()
  await expect(page.getByRole("heading", { name: secondTerm })).toBeVisible()

  expect(consoleErrors).toEqual([])
})
