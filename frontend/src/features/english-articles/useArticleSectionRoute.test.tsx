import { act, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import type { PropsWithChildren } from "react"

import { useArticleSectionRoute } from "./useArticleSectionRoute"

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = []
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()
  private readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    IntersectionObserverStub.instances.push(this)
  }

  trigger(entries: Partial<IntersectionObserverEntry>[]) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }
}

function wrapper(entries: string[]) {
  return function TestRouter({ children }: PropsWithChildren) {
    return <MemoryRouter initialEntries={entries}>{children}</MemoryRouter>
  }
}

function installSections() {
  const positions = new Map([
    ["section-1-opening", 40],
    ["section-2-shift", 480],
  ])
  for (const [id, top] of positions) {
    const section = document.createElement("section")
    section.id = id
    section.scrollIntoView = vi.fn()
    section.getBoundingClientRect = () => ({
      top: top - window.scrollY,
      bottom: top + 240 - window.scrollY,
      left: 0,
      right: 800,
      width: 800,
      height: 240,
      x: 0,
      y: top - window.scrollY,
      toJSON: () => ({}),
    })
    document.body.append(section)
  }
}

function useLocationValue() {
  return useLocation()
}

describe("useArticleSectionRoute", () => {
  it("replaces the hash when wheel scrolling reaches a new section", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    installSections()
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0, writable: true })

    const { result } = renderHook(
      () => ({
        route: useArticleSectionRoute(["section-1-opening", "section-2-shift"]),
        location: useLocationValue(),
      }),
      { wrapper: wrapper(["/reading/articles/a-1#section-1-opening"]) },
    )

    act(() => {
      window.scrollY = 520
      window.dispatchEvent(new Event("scroll"))
    })

    await waitFor(() => {
      expect(result.current.route.activeID).toBe("section-2-shift")
      expect(result.current.location.hash).toBe("#section-2-shift")
    })
  })

  it("pushes a route for an explicit directory choice and scrolls there", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    installSections()

    const { result } = renderHook(
      () => ({
        route: useArticleSectionRoute(["section-1-opening", "section-2-shift"]),
        location: useLocationValue(),
        navigate: useNavigate(),
      }),
      { wrapper: wrapper(["/reading/articles/a-1#section-1-opening"]) },
    )

    act(() => result.current.route.goToSection("section-2-shift"))

    expect(result.current.location.hash).toBe("#section-2-shift")
    expect(document.getElementById("section-2-shift")?.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    })

    act(() => result.current.navigate(-1))
    expect(result.current.location.hash).toBe("#section-1-opening")
  })

  it("keeps syncing the route after clicking the already-active section", async () => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub)
    IntersectionObserverStub.instances = []
    installSections()
    const sectionIDs = ["section-1-opening", "section-2-shift"]

    const { result } = renderHook(
      () => ({
        route: useArticleSectionRoute(sectionIDs),
        location: useLocationValue(),
      }),
      { wrapper: wrapper(["/reading/articles/a-1#section-1-opening"]) },
    )

    await waitFor(() => expect(IntersectionObserverStub.instances).toHaveLength(1))
    act(() => result.current.route.goToSection("section-1-opening"))

    const second = document.getElementById("section-2-shift") as HTMLElement
    act(() => IntersectionObserverStub.instances[0].trigger([
      { target: second, isIntersecting: true, intersectionRatio: 1 },
    ]))

    await waitFor(() => {
      expect(result.current.route.activeID).toBe("section-2-shift")
      expect(result.current.location.hash).toBe("#section-2-shift")
    })
  })

  it("restores a valid initial hash without moving for an invalid one", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    installSections()

    renderHook(() => useArticleSectionRoute(["section-1-opening", "section-2-shift"]), {
      wrapper: wrapper(["/reading/articles/a-1#section-2-shift"]),
    })
    expect(document.getElementById("section-2-shift")?.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    })

    const firstScroll = document.getElementById("section-1-opening")?.scrollIntoView as ReturnType<typeof vi.fn>
    firstScroll.mockClear()
    renderHook(() => useArticleSectionRoute(["section-1-opening", "section-2-shift"]), {
      wrapper: wrapper(["/reading/articles/a-1#missing"]),
    })
    expect(document.getElementById("section-1-opening")?.scrollIntoView).not.toHaveBeenCalled()
  })

  it("writes the first section into a blank route on the first article open", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    installSections()

    const { result } = renderHook(
      () => ({
        route: useArticleSectionRoute(["section-1-opening", "section-2-shift"]),
        location: useLocationValue(),
      }),
      { wrapper: wrapper(["/reading/articles/a-1"]) },
    )

    await waitFor(() => expect(result.current.location.hash).toBe("#section-1-opening"))
    expect(document.getElementById("section-1-opening")?.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    })
  })

  it("restores a deep link after asynchronously loaded sections appear", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    const target = document.createElement("section")
    target.id = "section-async-shift"
    target.scrollIntoView = vi.fn()
    const first = document.createElement("section")
    first.id = "section-async-opening"
    first.scrollIntoView = vi.fn()

    const { result, rerender } = renderHook(
      ({ ids }) => useArticleSectionRoute(ids),
      {
        initialProps: { ids: [] as string[] },
        wrapper: wrapper(["/reading/articles/a-1#section-async-shift"]),
      },
    )

    await waitFor(() => expect(result.current.activeID).toBe(""))
    document.body.append(first, target)
    rerender({ ids: ["section-async-opening", "section-async-shift"] })

    await waitFor(() => {
      expect(target.scrollIntoView).toHaveBeenCalledWith({
        behavior: "auto",
        block: "start",
      })
    })
  })

  it("observes sections, replaces the hash on intersection, and disconnects on unmount", async () => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub)
    IntersectionObserverStub.instances = []
    installSections()

    const { result, unmount } = renderHook(
      () => ({
        route: useArticleSectionRoute(["section-1-opening", "section-2-shift"]),
        location: useLocationValue(),
        navigate: useNavigate(),
      }),
      {
        wrapper: wrapper([
          "/reading/articles/a-1#before",
          "/reading/articles/a-1#section-1-opening",
        ]),
      },
    )

    await waitFor(() => expect(IntersectionObserverStub.instances).toHaveLength(1))
    const observer = IntersectionObserverStub.instances[0]
    expect(observer.observe).toHaveBeenCalledTimes(2)

    const second = document.getElementById("section-2-shift") as HTMLElement
    act(() => observer.trigger([{ target: second, isIntersecting: true, intersectionRatio: 1 }]))

    await waitFor(() => {
      expect(result.current.route.activeID).toBe("section-2-shift")
      expect(result.current.location.hash).toBe("#section-2-shift")
    })

    act(() => result.current.navigate(-1))
    expect(result.current.location.hash).toBe("#before")

    unmount()
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })
})
