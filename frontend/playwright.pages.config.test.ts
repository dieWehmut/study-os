import { describe, expect, it } from "vitest"

import { resolvePagesHarness } from "./playwright.pages.config"

describe("resolvePagesHarness", () => {
  it("keeps the development server as the default", () => {
    expect(resolvePagesHarness({ basePath: "study-os" })).toMatchObject({
      basePath: "/study-os/",
      baseURL: "http://127.0.0.1:5188/study-os/",
      command: "pnpm exec vite --host 127.0.0.1 --port 5188 --strictPort",
      server: "dev",
    })
  })

  it("can exercise an existing build through vite preview", () => {
    expect(resolvePagesHarness({
      basePath: "/docs/demo/",
      host: "localhost",
      port: "4199",
      preview: "true",
    })).toEqual({
      basePath: "/docs/demo/",
      baseURL: "http://localhost:4199/docs/demo/",
      command: "pnpm exec vite preview --host localhost --port 4199 --strictPort",
      host: "localhost",
      port: 4199,
      server: "preview",
    })
  })

  it("supports a root Pages deployment and rejects invalid ports", () => {
    expect(resolvePagesHarness({ basePath: "/", port: "70000" })).toMatchObject({
      basePath: "/",
      baseURL: "http://127.0.0.1:5188/",
      port: 5188,
    })
  })
})
