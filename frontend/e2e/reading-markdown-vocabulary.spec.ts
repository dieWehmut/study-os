import { expect, test, type Locator, type Page } from "@playwright/test"

const source = [
  "# Odyssey",
  "",
  "Tell me about a complicated man.",
  "",
  "At last, Athena answered.",
].join("\n")

async function expectWithinViewport(page: Page, locator: Locator) {
  const [box, viewport] = await Promise.all([locator.boundingBox(), Promise.resolve(page.viewportSize())])
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1)
}

test("edits, previews, resolves, and opens reading vocabulary", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => consoleErrors.push(error.message))

  await page.goto("/reading")
  await page.getByLabel("\u539f\u6587").fill(source)

  const workspace = page.getByTestId("markdown-workspace")
  const sourcePane = workspace.locator(":scope > section").nth(0)
  const preview = page.getByRole("region", { name: "Markdown \u5b9e\u65f6\u9884\u89c8" })
  const previewPane = workspace.locator(":scope > section").nth(1)
  await expect(preview).toContainText("Odyssey")
  await expect(preview).toContainText("At last, Athena answered.")
  await expect(page.getByRole("heading", { name: "\u7ed3\u6784" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "\u6b63\u6587" })).toBeVisible()

  const [sourceBox, previewBox] = await Promise.all([sourcePane.boundingBox(), previewPane.boundingBox()])
  expect(sourceBox).not.toBeNull()
  expect(previewBox).not.toBeNull()
  if (testInfo.project.name === "desktop-chromium") {
    expect(Math.abs(sourceBox!.y - previewBox!.y)).toBeLessThanOrEqual(2)
    expect(sourceBox!.x + sourceBox!.width).toBeLessThanOrEqual(previewBox!.x)
  } else {
    expect(previewBox!.y).toBeGreaterThanOrEqual(sourceBox!.y + sourceBox!.height)
  }

  const termButton = page.getByRole("button", { name: "\u67e5\u8bcd complicated" })
  const termBox = await termButton.boundingBox()
  await termButton.click()
  const vocabulary = page.getByRole("dialog", { name: "\u67e5\u8bcd complicated" })
  await expect(vocabulary).toContainText("meaning inferred from context:")
  await expect(vocabulary).toContainText("adjective")
  await expectWithinViewport(page, vocabulary)
  if (testInfo.project.name === "desktop-chromium") {
    const vocabularyBox = await vocabulary.boundingBox()
    expect(termBox).not.toBeNull()
    expect(vocabularyBox).not.toBeNull()
    expect(Math.abs(vocabularyBox!.x - termBox!.x)).toBeLessThan(380)
    const separatedVertically = vocabularyBox!.y >= termBox!.y + termBox!.height
      || vocabularyBox!.y + vocabularyBox!.height <= termBox!.y
    expect(separatedVertically).toBe(true)
  }

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-reading-markdown-vocabulary.png`),
    fullPage: false,
  })

  await vocabulary.getByRole("link", { name: "\u5728\u77e5\u8bc6\u5e93\u67e5\u770b" }).click()
  await expect(page).toHaveURL(/\/knowledge\?item=vocab-/)
  await expect(page.getByRole("heading", { name: "complicated" })).toBeVisible()
  await expect(page.getByText(/meaning inferred from context:/).first()).toBeVisible()
  expect(consoleErrors).toEqual([])
})
