import { expect, test } from "@playwright/test"

// 归档 的端到端来回：藏起来、找得回来、链接一直能开。
//
// The feature shipped with store, HTTP and panel tests, but nothing had ever pressed the
// button in a browser and then asked the API whether the item was really hidden -- and
// "hidden but findable" is the whole point of 归档 rather than 删除.
//
// Three lessons from the earlier schedule-undo spec are built in here: exact accessible
// names (Playwright's `name` matches substrings, so 归档 would also match 取消归档), a
// marker unique per run (the two projects share one backend), and cleanup that does not
// depend on the page still being alive.
test("puts an item away, finds it again, and keeps its link working", async ({ page, request }) => {
  const marker = `归档${Date.now()}`
  const dumped = await request.post("/api/dump", { data: { text: `${marker} / 藏起来再找回来` } })
  expect(dumped.status()).toBe(201)
  const id: string = (await dumped.json()).id

  try {
    await page.goto(`/knowledge?item=${encodeURIComponent(id)}`)
    const archive = page.getByRole("button", { name: "归档", exact: true })
    await expect(archive).toBeVisible({ timeout: 15_000 })

    await archive.click()
    await expect(page.getByText(/已归档 · 默认列表里不再显示它/)).toBeVisible()

    // The default library no longer lists it...
    const defaultView = await (await request.get("/api/knowledge?limit=200")).text()
    expect(defaultView).not.toContain(id)
    // ...asking for archived items brings it back...
    const asked = await (await request.get("/api/knowledge?archived=yes&limit=200")).text()
    expect(asked).toContain(id)
    // ...and the link someone already has still opens it.
    const detail = await request.get(`/api/knowledge/${encodeURIComponent(id)}`)
    expect(detail.status()).toBe(200)

    // 取消归档 is offered in place, so the round trip closes without a reload.
    const unarchive = page.getByRole("button", { name: "取消归档", exact: true })
    await expect(unarchive).toBeVisible()
    await unarchive.click()
    await expect(page.getByText(/已取消归档 · 回到默认列表/)).toBeVisible()

    const back = await (await request.get("/api/knowledge?limit=200")).text()
    expect(back).toContain(id)
  } finally {
    // Idempotent, and independent of the page: a failing run must not leave the item
    // archived for whatever spec runs next.
    await request.delete(`/api/knowledge/${encodeURIComponent(id)}/archive`)
  }
})