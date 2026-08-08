import { expect, test, type Page } from "@playwright/test"

// The queue serves three different answer shapes and the scheduler decides which
// comes first, so dispatch on the control that is actually on screen rather than
// parsing the mode badge. The old helper assumed every prompt had a text box,
// which silently stopped being true when en_to_zh became self-graded.
async function answerCurrentPrompt(page: Page): Promise<"self-rated" | "overridden"> {
  const selfRating = page.getByRole("group", { name: "自评掌握程度" })
  const choices = page.getByRole("group", { name: "选择答案" })

  if (await selfRating.isVisible()) {
    // Recognition is self-graded: there is nothing to type and no rating to
    // override, so the reference answer is the only confirmation available.
    // exact, because accessible-name matching is substring-based by default and
    // "认识" is contained in "不认识" -- the opposite rating.
    await page.getByRole("button", { name: "认识", exact: true }).click()
    await expect(page.getByText("参考答案")).toBeVisible()
    await page.getByRole("button", { name: "下一题" }).click()
    return "self-rated"
  }

  if (await choices.isVisible()) {
    await choices.getByRole("button").first().click()
  } else {
    // Any non-empty answer reaches the grader; the override below is what this
    // spec actually asserts, so the text does not have to be correct.
    await page.getByLabel("你的答案").fill("abandon")
    await page.getByRole("button", { name: "提交答案" }).click()
  }

  await expect(page.getByText(/正确|部分正确|需要重学/).first()).toBeVisible()
  await page.getByRole("button", { name: "改判为掌握" }).click()
  await expect(page.getByText(/系统他评 · 良好/)).toBeVisible()
  await page.getByRole("button", { name: "下一题" }).click()
  return "overridden"
}

// The reviewed word is content nested under the page, not the page's own title,
// so it is an h2. Asserting a single h1 keeps the document outline honest: a
// second h1 here made `main h1` ambiguous and broke this spec outright.
async function questionText(page: Page): Promise<string> {
  const heading = page.locator("main h2")
  await expect(heading).toBeVisible({ timeout: 15_000 })
  await expect(page.locator("main h1")).toHaveCount(1)
  return (await heading.textContent())?.trim() ?? ""
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
  const firstQuestion = await questionText(page)
  const dueBefore = await currentProgress(page)
  await answerCurrentPrompt(page)

  await page.reload()
  const dueAfter = await currentProgress(page)
  expect(dueAfter).toBe(dueBefore - 1)
  expect(await questionText(page)).not.toBe(firstQuestion)

  await page.goto("/knowledge")
  await page.getByRole("button", { name: new RegExp(secondTerm) }).click()
  await expect(page.getByRole("heading", { name: secondTerm })).toBeVisible()

  expect(consoleErrors).toEqual([])
})
