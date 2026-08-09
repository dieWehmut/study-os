import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { useSubjectStore } from "@/store/useSubjectStore"
import { navigationForPath } from "./navigation"

describe("application shell", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("dark")
    document.documentElement.style.colorScheme = ""
    useSubjectStore.setState({ subject: "all" })
		vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
  })

  it.each([
    ["/", "首页"],
    ["/knowledge", "知识库"],
    ["/reading", "阅读"],
    ["/memory", "记忆"],
    ["/import", "导入"],
    ["/settings", "设置"],
  ])("renders the %s route and navigation label %s", (route, label) => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole("main")).toBeInTheDocument()
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  })

  it("keeps the legacy practice route reachable without adding it to primary navigation", () => {
    render(
      <MemoryRouter initialEntries={["/practice"]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole("main")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "练习" })).toBeInTheDocument()
    expect(screen.queryAllByRole("link", { name: "练习" })).toHaveLength(0)
  })

  it("does not treat similar path prefixes as active navigation routes", () => {
    expect(navigationForPath("/knowledgeable").path).toBe("/")
    expect(navigationForPath("/knowledge/item-1").path).toBe("/knowledge")
  })

  it("marks the current route and shows navigation in desktop sidebar and mobile drawer", () => {
    render(
      <MemoryRouter initialEntries={["/memory"]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole("link", { name: "记忆" })[0]).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument()
  })

  it("opens the mobile drawer from the header and closes it after navigating", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    )

    // Closed drawer sets aria-hidden, so query the DOM rather than the a11y tree.
    const drawer = document.querySelector(
      'aside[aria-hidden] nav[aria-label="移动端主导航"]',
    )?.parentElement as HTMLElement
    expect(drawer).toHaveAttribute("aria-hidden", "true")

    fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }))
    expect(drawer).toHaveAttribute("aria-hidden", "false")

    const drawerLink = drawer.querySelector('a[href="/memory"]') as HTMLElement
    fireEvent.click(drawerLink)
    expect(drawer).toHaveAttribute("aria-hidden", "true")
  })

  it("removes verbose nav descriptions and gives the sidebar one fixed width", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.queryByText("今天的学习入口")).not.toBeInTheDocument()
    // 侧栏宽度不再是用户能调的东西，所以既没有把手，也不该有一个由 state 驱动的
    // 内联宽度——宽度写死在类里，才不会有"上次拖到多宽"这种要记的状态。
    expect(screen.queryByRole("separator", { name: "调整侧栏宽度" })).not.toBeInTheDocument()
    const sidebar = container.querySelector("aside")
    expect(sidebar?.getAttribute("style") ?? "").not.toContain("width")
  })


  it("centers the nav buttons as one group in both the sidebar and the drawer", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    )

    // jsdom computes no layout, so pin the two classes that produce the
    // centering instead: the nav has to stretch and center its own children,
    // and nothing may push it down from the top. A leading margin is what used
    // to leave the group sitting high in the rail on tall screens.
    // The closed drawer is aria-hidden, so reach it through the DOM.
    const navs = document.querySelectorAll("aside nav")
    expect(navs).toHaveLength(2)
    for (const nav of navs) {
      expect(nav.className).toContain("flex-1")
      expect(nav.className).toContain("justify-center")
      expect(nav.className).not.toMatch(/(^|\s)mt-/)
    }

  })

  it("puts 首页 first in the sidebar and switches subjects from the home page", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    )

    const sidebarLinks = Array.from(document.querySelectorAll("aside nav a"))
    expect(sidebarLinks[0]?.textContent?.trim()).toBe("首页")
    const math = screen.getByRole("button", { name: "数学" })
    fireEvent.click(math)
    expect(math).toHaveAttribute("aria-pressed", "true")
    expect(localStorage.getItem("study-os.subject")).toBe("math")
  })

  it("places 阅读 before 记忆, since previewing comes before reviewing", () => {
    // The rail's order is the only place the two-phase model is visible:
    // 阅读 prepares material you have not met yet, 记忆 returns to material
    // you have. Listing review first would read as the whole app.
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    )

    const labels = Array.from(document.querySelectorAll("aside nav a")).map((link) =>
      link.textContent?.trim(),
    )
    expect(labels.indexOf("阅读")).toBeGreaterThan(-1)
    expect(labels.indexOf("阅读")).toBeLessThan(labels.indexOf("记忆"))
  })

  it("switches subjects from the in-page subject chips", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <App />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole("button", { name: "英语" }))
    expect(useSubjectStore.getState().subject).toBe("english")
  })

  it("switches the page theme from the header and persists the choice", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    )

    const toggle = screen.getByRole("button", { name: "切换到暗色模式" })
    fireEvent.click(toggle)

    expect(document.documentElement).toHaveClass("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")
    expect(localStorage.getItem("study-os-theme")).toBe("dark")
    expect(screen.getByRole("button", { name: "切换到亮色模式" })).toBeInTheDocument()
  })

	it("restores a saved dark theme", () => {
		localStorage.setItem("study-os-theme", "dark")

		render(
			<MemoryRouter initialEntries={["/"]}>
				<App />
			</MemoryRouter>,
		)

		expect(document.documentElement).toHaveClass("dark")
		expect(screen.getByRole("button", { name: "切换到亮色模式" })).toBeInTheDocument()
	})

	it("uses the system dark preference when no choice is saved", () => {
		vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))

		render(
			<MemoryRouter initialEntries={["/"]}>
				<App />
			</MemoryRouter>,
		)

		expect(document.documentElement).toHaveClass("dark")
		expect(localStorage.getItem("study-os-theme")).toBeNull()
	})
})
