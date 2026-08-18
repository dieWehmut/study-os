import { describe, expect, it } from "vitest"

import { routerMode, type RuntimeEnv } from "./runtime"

describe("route strategy", () => {
  it("does not depend on a server rewrite for static deep links", () => {
    const pagesEnv: RuntimeEnv = { VITE_STATIC_DEMO: "true", BASE_URL: "/study-os/" }
    expect(routerMode(pagesEnv)).toBe("hash")
  })

  it("keeps the backend-backed app on browser URLs", () => {
    expect(routerMode({ VITE_STATIC_DEMO: "", BASE_URL: "/" })).toBe("browser")
  })
})
