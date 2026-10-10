import { expect, test } from "@playwright/test"

// The clipboard cannot be faked from outside the page, so this is the one thing
// the unit tests cannot say: that the button really puts an address there.
test.use({ permissions: ["clipboard-read", "clipboard-write"] })

test("copies the address of the knowledge item on screen", async ({ page }) => {
  // Its own data: the knowledge page has nothing to copy on a fresh database, and
  // another spec's import is not something this one may depend on.
  await page.request.post("/api/dump", { data: { text: "放弃\n\nThey abandoned the project." } })

  await page.goto("/knowledge")
  const copy = page.getByRole("button", { name: "复制链接" }).first()
  await expect(copy).toBeVisible({ timeout: 15_000 })
  await copy.click()

  // The button says so itself, which is what the reader sees.
  await expect(page.getByRole("button", { name: "已复制链接" })).toBeVisible()

  const copied = await page.evaluate(() => navigator.clipboard.readText())
  const url = new URL(copied)
  expect(url.pathname.endsWith("/knowledge")).toBe(true)
  expect(url.searchParams.get("item")).toBeTruthy()
  console.log("COPIED", copied)

  // The point of copying it is being able to open it: same page, same item.
  const heading = await page.getByRole("heading").first().textContent()
  await page.goto(copied)
  await expect(page.getByRole("heading", { name: heading ?? "" })).toBeVisible({ timeout: 15_000 })
})