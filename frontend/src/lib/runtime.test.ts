import { describe, expect, it } from "vitest"

import { isStaticDemo, publicBasePath, routerMode, type RuntimeEnv } from "./runtime"

describe("frontend deployment runtime", () => {
  it("selects static demo mode only for an explicit true flag", () => {
    expect(isStaticDemo({ VITE_STATIC_DEMO: "true" })).toBe(true)
    expect(isStaticDemo({ VITE_STATIC_DEMO: "false" })).toBe(false)
    expect(isStaticDemo({})).toBe(false)
  })

  it("uses hash routing for Pages and browser routing elsewhere", () => {
    expect(routerMode({ VITE_STATIC_DEMO: "true" })).toBe("hash")
    expect(routerMode({ VITE_STATIC_DEMO: "1" })).toBe("browser")
  })

  it("normalizes the Vite base path without losing the root fallback", () => {
    expect(publicBasePath({ BASE_URL: "/study-os/" } satisfies RuntimeEnv)).toBe("/study-os/")
    expect(publicBasePath({ BASE_URL: "study-os" } satisfies RuntimeEnv)).toBe("/study-os/")
    expect(publicBasePath({ BASE_URL: "" } satisfies RuntimeEnv)).toBe("/")
  })
})
