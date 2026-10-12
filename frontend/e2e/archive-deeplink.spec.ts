import { expect, test } from "@playwright/test"

// 深链接打开一条**已经归档**的条目：面板必须说得出它已归档。
//
// The panel used to start from its own local state, so this case offered 「归档」 for an
// item that was already put away -- a button saying the opposite of the truth. The unit
// test covers the request it sends; this covers what the reader actually sees after
// following a link someone kept.
//
// The three rules the other archive specs settled on: exact accessible names, a marker
// unique per run (two projects share one backend), and API cleanup in a `finally`.
test("offers 取消归档 when a link opens an item that is already archived", async ({ page, request }) => {
  const marker = `深链${Date.now()}`
  const dumped = await request.post("/api/dump", { data: { text: `${marker} / 链接打开的是收起来的条目` } })
  expect(dumped.status()).toBe(201)
  const id: string = (await dumped.json()).id

  try {
    expect((await request.post(`/api/knowledge/${encodeURIComponent(id)}/archive`)).status()).toBe(200)

    // Straight to the item, with no list involved: this is the path that had no source for
    // the archive state at all.
    await page.goto(`/knowledge?item=${encodeURIComponent(id)}`)

    const cancel = page.getByRole("button", { name: "取消归档", exact: true })
    await expect(cancel).toBeVisible({ timeout: 15_000 })
    // And the wrong label is not merely absent by accident: it must not be there at all.
    await expect(page.getByRole("button", { name: "归档", exact: true })).toHaveCount(0)
  } finally {
    await request.delete(`/api/knowledge/${encodeURIComponent(id)}/archive`)
  }
})