import { expect, test, type Locator, type Page } from "@playwright/test"
import { stat } from "node:fs/promises"

const articleTitle = "Cities That Learn From Rain"
const originalTitle = "How Streets Can Hold Water"
const originalText = [
  "Cities once treated rainwater as a problem to remove as quickly as possible.",
  "New parks, planted roofs, and permeable streets now give water time to slow down and sink into the ground.",
  "This patient approach protects homes during storms while making neighbourhoods cooler and more pleasant every day.",
  "When engineers, residents, and local rivers are planned together, a wet street can become useful public space.",
].join(" ")

async function expectWithinViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1)
}

async function expectNoOverlap(first: Locator, second: Locator) {
  const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()])
  expect(firstBox).not.toBeNull()
  expect(secondBox).not.toBeNull()
  const overlaps = firstBox!.x < secondBox!.x + secondBox!.width
    && firstBox!.x + firstBox!.width > secondBox!.x
    && firstBox!.y < secondBox!.y + secondBox!.height
    && firstBox!.y + firstBox!.height > secondBox!.y
  expect(overlaps).toBe(false)
}

test("creates, reads, deep-links, and exports a Mock AI English article", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => consoleErrors.push(error.message))

  await page.goto("/reading/articles")
  await page.getByRole("link", { name: "添加文章" }).click()
  await page.getByLabel("中文展示标题").fill(articleTitle)
  await page.getByLabel("原文标题").fill(originalTitle)
  await page.getByLabel("作者").fill("Study OS E2E")
  await page.getByLabel("来源", { exact: true }).fill("Mock AI Gazette")
  await page.getByLabel("英文原文").fill(originalText)
  await page.getByRole("button", { name: "生成预览" }).click()

  await expect(page.getByText("保存前预览")).toBeVisible()
  await expect(page.getByText("这是对应英文段落的离线示例翻译。").first()).toBeVisible()
  await expect(page.getByRole("heading", { name: /1\. 1\. Reading focus/ })).toBeVisible()
  await expect(page.getByRole("heading", { name: /2\. 2\. Reading focus/ })).toBeVisible()

  await page.getByRole("button", { name: "保存文章" }).click()
  await page.waitForURL(/\/reading\/articles\/article-[^/#]+(?:#.*)?$/)
  const savedPath = new URL(page.url()).pathname
  expect(savedPath).toMatch(/^\/reading\/articles\/[^/]+$/)

  const article = page.locator("[data-article-root]")
  const directory = page.getByRole("navigation", { name: "文章目录" })
  await expect(page.getByRole("heading", { level: 1, name: articleTitle })).toBeVisible()
  await expect(page.getByText(originalTitle)).toBeVisible()
  await expect(article.getByRole("blockquote").filter({ hasText: originalText.slice(0, 48) })).toBeVisible()
  await expect(article.getByText("这是对应英文段落的离线示例翻译。").first()).toBeVisible()
  await expect(article.getByRole("heading", { name: "重点词汇" }).first()).toBeVisible()
  await expect(article).toHaveJSProperty("scrollWidth", await article.evaluate((element) => element.clientWidth))

  await page.evaluate(() => window.scrollTo(0, 0))
  const mobileDirectoryToggle = directory.getByRole("button", { name: "章节目录" })
  if (await mobileDirectoryToggle.isVisible()) await mobileDirectoryToggle.click()
  const directoryLinks = directory.locator("a")
  await expect(directoryLinks).toHaveCount(2)
  await expect(directoryLinks.first()).toHaveAttribute("aria-current", "true")
  await expectWithinViewport(page, page.getByRole("toolbar", { name: "文章工具" }))
  await expectWithinViewport(page, directory)
  await expectNoOverlap(directory, article)

  const secondSection = page.locator('section[id^="section-2-"]')
  await page.mouse.wheel(0, 1_400)
  await expect(secondSection).toBeInViewport()
  await expect(page).toHaveURL(new RegExp(`${savedPath}#section-2-`))
  await expect(directoryLinks.nth(1)).toHaveAttribute("aria-current", "true")
  await expect(secondSection).toHaveJSProperty("scrollWidth", await secondSection.evaluate((element) => element.clientWidth))

  await page.reload()
  await expect(secondSection).toBeInViewport()
  await expect(directoryLinks.nth(1)).toHaveAttribute("aria-current", "true")

  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-english-article.png`), fullPage: true })
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 PDF" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  expect((await stat(downloadPath!)).size).toBeGreaterThan(0)

  expect(consoleErrors).toEqual([])
})
