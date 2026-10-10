import { expect, test } from "@playwright/test"

/**
 * A directory click lands on the section it names, and stays there.
 *
 * Measured in Chromium before this was fixed: clicking 第四节 scrolled there, the
 * scroll-driven route sync then reported 第三节 (which the smooth scroll was
 * passing) and dragged the address -- and the page -- back, so the reader never
 * arrived and the outline named the wrong section.
 *
 * Five sections rather than two: the section above the target has to still be in
 * the observer's band for the old code to pick it.
 */
test("a directory click is not undone while the page scrolls there", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })

  const sections = [1, 2, 3, 4, 5].map((index) => ({
    title: `Section ${index}`,
    paragraphs: [
      { segments: [{ text: `Paragraph one of section ${index}.` }], translation: `第 ${index} 节第一段。` },
      { segments: [{ text: `Paragraph two of section ${index}.` }], translation: `第 ${index} 节第二段。` },
      { segments: [{ text: `Paragraph three of section ${index}.` }], translation: `第 ${index} 节第三段。` },
    ],
    vocabulary: [],
  }))
  const created = await page.request.post("/api/english/articles", {
    data: {
      title: "滚动同步",
      original_title: "Scroll sync",
      original_text: sections
        .flatMap((section) => section.paragraphs.map((paragraph) => paragraph.segments.map((segment) => segment.text).join("")))
        .join("\n\n"),
      content: { metadata: { original_title: "Scroll sync" }, sections },
    },
  })
  expect(created.status()).toBe(201)
  const article = (await created.json()) as { id: string }
  await page.goto(`/reading/articles/${article.id}`)
  await page.waitForTimeout(1500)

  const directory = page.getByRole("navigation", { name: "文章目录" })
  const links = directory.locator("a")
  expect(await links.count()).toBe(5)

  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  const target = links.nth(3)
  const targetHash = (await target.getAttribute("href"))!
  await target.click()

  // The address must not wander off the section that was clicked, and the page
  // has to end up there -- the old fight left it on the section above.
  const seen = new Set<string>()
  for (let index = 0; index < 24; index += 1) {
    seen.add(await page.evaluate(() => window.location.hash))
    await page.waitForTimeout(50)
  }
  expect([...seen]).toEqual([targetHash])
  expect(await page.evaluate(() => window.location.hash)).toBe(targetHash)
  await expect(target).toHaveAttribute("aria-current", "true")
  await expect(page.locator(`section[id="${targetHash.slice(1)}"]`)).toBeInViewport()
})