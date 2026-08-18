import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@giscus/react", () => ({
  default: () => <div data-testid="giscus-widget" />,
}))

import { AppShell } from "./AppShell"

const configuredEnv = {
  VITE_STATIC_DEMO: "true",
  VITE_GISCUS_REPO: "dieWehmut/study-os",
  VITE_GISCUS_REPO_ID: "R_kgDOTp_mMw",
  VITE_GISCUS_CATEGORY: "Announcements",
  VITE_GISCUS_CATEGORY_ID: "DIC_kwDOexample",
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/knowledge"]}>
      <AppShell>
        <article data-testid="route-content">Route content</article>
      </AppShell>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
  for (const [key, value] of Object.entries(configuredEnv)) {
    vi.stubEnv(key, value)
  }
  document.documentElement.classList.remove("dark")
})

afterEach(() => {
  vi.unstubAllEnvs()
  document.documentElement.classList.remove("dark")
})

describe("AppShell comments placement", () => {
  it("renders configured comments after the current route content", () => {
    renderShell()

    const content = screen.getByTestId("route-content")
    const comments = screen.getByRole("region", { name: "页面评论" })

    expect(content.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ["non-static", { VITE_STATIC_DEMO: "false" }],
    ["incomplete configuration", { VITE_GISCUS_CATEGORY_ID: "" }],
  ])("does not render comments for %s", (_caseName, overrides) => {
    for (const [key, value] of Object.entries(overrides)) {
      vi.stubEnv(key, value)
    }

    renderShell()

    expect(screen.queryByRole("region", { name: "页面评论" })).not.toBeInTheDocument()
  })
})
