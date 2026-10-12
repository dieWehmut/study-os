import { expect, test } from "@playwright/test"

// 「显示已归档」开关的端到端来回。
//
// The switch exists because 归档 hides items by default, so without it an archived item is
// only reachable by a link someone kept. The unit test covers the request it sends; this
// covers what the reader sees: the item appears when the switch is on, and disappears when
// it is turned back off.
//
// Same three rules as the schedule-undo and archive-roundtrip specs: exact accessible
// names, a marker unique per run (two projects share one backend), and API cleanup in a
// `finally` so a failing run leaves nothing behind.
test("shows archived items behind the switch and hides them again", async ({ page, request }) => {
  const marker = `开关${Date.now()}`
  const dumped = await request.post("/api/dump", { data: { text: `${marker} / 一个被收起来的条目` } })
  expect(dumped.status()).toBe(201)
  const id: string = (await dumped.json()).id

  try {
    expect((await request.post(`/api/knowledge/${encodeURIComponent(id)}/archive`)).status()).toBe(200)

    // Default view: the item is put away, and the switch is off.
    await page.goto("/knowledge")
    const toggleOff = page.getByRole("button", { name: "显示已归档", exact: true })
    await expect(toggleOff).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(`${marker}`)).toHaveCount(0)

    // Turning it on brings the item back -- and the switch says so.
    // `.first()`: the marker legitimately appears more than once on the row (term,
    // definition, and the count line), and this test is about the row being present at
    // all, not about any one of those places.
    await toggleOff.click()
    const toggleOn = page.getByRole("button", { name: "显示已归档 · 开", exact: true })
    await expect(toggleOn).toBeVisible()
    await expect(page.getByText(new RegExp(marker)).first()).toBeVisible()
    // And the row says which one it is: the switch widened the list, and the marker is what
    // stops the reader having to guess which entries they put away themselves.
    await expect(page.locator("[data-archived-marker='true']")).toHaveCount(1)

    // And it survives a reload, because the state lives in the link.
    await page.reload()
    await expect(page.getByText(new RegExp(marker)).first()).toBeVisible()

    // Turning it off puts it away again.
    await page.getByRole("button", { name: "显示已归档 · 开", exact: true }).click()
    await expect(page.getByText(new RegExp(marker))).toHaveCount(0)
  } finally {
    await request.delete(`/api/knowledge/${encodeURIComponent(id)}/archive`)
  }
})