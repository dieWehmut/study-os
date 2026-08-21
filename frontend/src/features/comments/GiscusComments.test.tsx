import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  giscus: vi.fn(),
}))

vi.mock("@giscus/react", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.giscus(props)
    return <div data-testid="giscus-widget" />
  },
}))

import { GiscusComments } from "./GiscusComments"

const configuredEnv = {
  VITE_STATIC_DEMO: "true",
  VITE_GISCUS_REPO: "dieWehmut/study-os",
  VITE_GISCUS_REPO_ID: "R_kgDOTp_mMw",
  VITE_GISCUS_CATEGORY: "Announcements",
  VITE_GISCUS_CATEGORY_ID: "DIC_kwDOexample",
}

function renderAt(pathname = "/knowledge") {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <GiscusComments />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  for (const [key, value] of Object.entries(configuredEnv)) {
    vi.stubEnv(key, value)
  }
  document.documentElement.classList.remove("dark")
  mocks.giscus.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  document.documentElement.classList.remove("dark")
})

describe("GiscusComments", () => {
  it("does not render when static-demo mode is disabled", () => {
    vi.stubEnv("VITE_STATIC_DEMO", "false")

    renderAt()

    expect(screen.queryByRole("region", { name: "讨论" })).not.toBeInTheDocument()
    expect(mocks.giscus).not.toHaveBeenCalled()
  })

  it("does not render when public Giscus configuration is incomplete", () => {
    vi.stubEnv("VITE_GISCUS_CATEGORY_ID", "")

    renderAt()

    expect(screen.queryByRole("region", { name: "讨论" })).not.toBeInTheDocument()
    expect(mocks.giscus).not.toHaveBeenCalled()
  })

  it("uses a route-specific discussion term and fixed widget options", () => {
    renderAt("/knowledge")

    expect(screen.getByRole("region", { name: "讨论" })).toBeInTheDocument()
    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
    expect(mocks.giscus).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "dieWehmut/study-os",
        repoId: "R_kgDOTp_mMw",
        category: "Announcements",
        categoryId: "DIC_kwDOexample",
        mapping: "specific",
        term: "study-os:/knowledge",
        strict: "1",
        reactionsEnabled: "1",
        emitMetadata: "0",
        inputPosition: "bottom",
        lang: "zh-CN",
        loading: "lazy",
        theme: "light",
      }),
    )
  })

  it("follows the root dark class and returns to light when it is removed", async () => {
    document.documentElement.classList.add("dark")
    renderAt("/settings")

    expect(mocks.giscus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        term: "study-os:/settings",
        theme: "dark",
      }),
    )

    document.documentElement.classList.remove("dark")

    await waitFor(() => {
      expect(mocks.giscus).toHaveBeenLastCalledWith(
        expect.objectContaining({ theme: "light" }),
      )
    })
  })
})
