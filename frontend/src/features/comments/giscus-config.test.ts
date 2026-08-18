import { describe, expect, it } from "vitest"

import { giscusConfig, giscusTerm, type GiscusEnv } from "./giscus-config"

const configured: GiscusEnv = {
  VITE_GISCUS_REPO: "dieWehmut/study-os",
  VITE_GISCUS_REPO_ID: "R_kgDOTp_mMw",
  VITE_GISCUS_CATEGORY: "Announcements",
  VITE_GISCUS_CATEGORY_ID: "DIC_kwDOexample",
}

describe("giscus configuration", () => {
  it("returns null until all public identifiers are configured", () => {
    expect(giscusConfig({ ...configured, VITE_GISCUS_CATEGORY_ID: "" })).toBeNull()
  })

  it("normalizes route terms without a trailing slash", () => {
    expect(giscusTerm("/")).toBe("study-os:/")
    expect(giscusTerm("/knowledge/")).toBe("study-os:/knowledge")
    expect(giscusTerm("/reading/articles/article-1")).toBe("study-os:/reading/articles/article-1")
  })

  it("returns the exact public Giscus configuration", () => {
    expect(giscusConfig(configured)).toEqual({
      repo: configured.VITE_GISCUS_REPO,
      repoId: configured.VITE_GISCUS_REPO_ID,
      category: configured.VITE_GISCUS_CATEGORY,
      categoryId: configured.VITE_GISCUS_CATEGORY_ID,
    })
  })
})
