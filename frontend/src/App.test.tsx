import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "./App"
import { useSubjectStore } from "@/store/useSubjectStore"

// The pages behind these routes fetch on mount; the router is what is under test,
// so every call answers with an empty page rather than reaching the network.
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client")
  return {
    ...actual,
    apiRequest: vi.fn(() => Promise.resolve({ items: [], count: 0 })),
  }
})

function RouteReporter() {
  const location = useLocation()
  return <output data-testid="route">{location.pathname}</output>
}

describe("App routing", () => {
  beforeEach(() => {
    useSubjectStore.setState({ subject: "all" })
    // The shell asks the media query for the colour scheme; jsdom has no
    // implementation of it.
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
  })

  it("falls back to 首页 for a route that does not exist", async () => {
    // A stale or mistyped link must not land on a blank screen. The shell keeps
    // its navigation, so the fallback is what the reader sees instead.
    render(
      <MemoryRouter initialEntries={["/reading/articles/../nope"]}>
        <App />
        <RouteReporter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId("route")).toHaveTextContent("/"))
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument()
  })

  it("keeps an unknown 课程 id on its own page rather than redirecting it", async () => {
    // A specific id is handled by the page (which can say 课程不存在), not by the
    // catch-all: redirecting it to 首页 would hide the reason it did not load.
    render(
      <MemoryRouter initialEntries={["/lessons/does-not-exist"]}>
        <App />
        <RouteReporter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId("route")).toHaveTextContent("/lessons/does-not-exist"))
    // The shell is still there, so the reader can leave; what the page does with
    // the missing id is its own business (it has a retry and a 返回课程 link).
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument()
  })
})