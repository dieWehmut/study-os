import { expect, test } from "@playwright/test"

// 排进复习 ↔ 取消排复习，在真正的界面上走一个完整的来回。
//
// Its first version was withdrawn: it timed out on the second cancel and, worse, left a
// queued item behind that broke `study-loop` on the shared backend. Both are addressed
// here -- the button is located with `exact: true` (Playwright's `name` matches
// substrings by default, so 「取消排复习」 also matched an aria-label), the marker is
// unique per run (two projects share one backend), and cleanup goes through the API in a
// `finally`, so even a failure leaves the queue as it was found.
test("puts an item into the review queue, takes it out, and puts it back", async ({ page, request }) => {
  const marker = `来回${Date.now()}`
  const dumped = await request.post("/api/dump", { data: { text: `${marker} / 三个方向都要行` } })
  expect(dumped.status()).toBe(201)
  const id: string = (await dumped.json()).id

  try {
    await page.goto(`/knowledge?item=${encodeURIComponent(id)}`)
    const queue = page.getByRole("button", { name: "排进复习", exact: true })
    await expect(queue).toBeVisible({ timeout: 15_000 })

    await queue.click()
    await expect(page.getByText(/已排进复习 · \d+ 张卡/)).toBeVisible()
    expect(await (await request.get("/api/reviews/due?limit=50")).text()).toContain(marker)

    const cancel = page.getByRole("button", { name: "取消排复习", exact: true })
    await expect(cancel).toBeVisible()
    await cancel.click()
    await expect(page.getByText(/已取消复习安排 · 移出 \d+ 张卡/)).toBeVisible()
    expect(await (await request.get("/api/reviews/due?limit=50")).text()).not.toContain(marker)

    // Back in -- and the way out is offered again. A flag that hid the cancel button
    // after 取消 → 排进复习 was a real bug, found only by driving both buttons in a row.
    await queue.click()
    await expect(page.getByText(/已排进复习 · \d+ 张卡/)).toBeVisible()
    await expect(cancel).toBeVisible()
    expect(await (await request.get("/api/reviews/due?limit=50")).text()).toContain(marker)
  } finally {
    // Idempotent, and it does not depend on the page still being alive: a failing test
    // must not leave a queued item behind for the next spec.
    await request.delete(`/api/knowledge/${encodeURIComponent(id)}/schedule`)
  }
})