import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"

describe("application shell", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("dark")
    document.documentElement.style.colorScheme = ""
		vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
  })

  it.each([
    ["/", "今日"],
    ["/knowledge", "知识库"],
    ["/memory", "记忆"],
    ["/practice", "练习"],
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

  it("marks the current route and exposes mobile navigation labels", () => {
    render(
      <MemoryRouter initialEntries={["/memory"]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole("link", { name: "记忆" })[0]).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.getByRole("navigation", { name: "移动导航" })).toBeInTheDocument()
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
