import { beforeEach, describe, expect, it, vi } from "vitest"

import { appUrl, appUrlWithHash, copyUrl } from "./link"
import { routerMode } from "./runtime"

vi.mock("./runtime", () => ({ routerMode: vi.fn(() => "browser") }))

const mockedMode = vi.mocked(routerMode)

describe("appUrl", () => {
  beforeEach(() => {
    mockedMode.mockReturnValue("browser")
    vi.stubGlobal("location", { origin: "https://example.test", pathname: "/study-os/" })
  })

  it("builds the address from the route, not from the address bar", () => {
    // The desktop shell has no address bar, and the route is what the reader means.
    expect(appUrl("/knowledge", "?item=k-1")).toBe("https://example.test/knowledge?item=k-1")
  })

  it("keeps the route inside the hash when the Pages build is hash-routed", () => {
    // Putting the path before the # lands on the site root with the target missing.
    mockedMode.mockReturnValue("hash")
    expect(appUrl("/reading/articles/article-1")).toBe("https://example.test/study-os/#/reading/articles/article-1")
  })

  it("appends a section anchor after the hash route rather than replacing it", () => {
    mockedMode.mockReturnValue("hash")
    expect(appUrlWithHash("/reading/articles/article-1", "", "#section-2"))
      .toBe("https://example.test/study-os/#/reading/articles/article-1#section-2")
    mockedMode.mockReturnValue("browser")
    expect(appUrlWithHash("/reading/articles/article-1", "", "#section-2"))
      .toBe("https://example.test/reading/articles/article-1#section-2")
  })
})

describe("copyUrl", () => {
  it("answers whether the browser allowed it", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    await expect(copyUrl("https://example.test/x")).resolves.toBe(true)

    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } })
    await expect(copyUrl("https://example.test/x")).resolves.toBe(false)
  })
})