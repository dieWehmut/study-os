import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { SidebarProfile } from "./SidebarProfile"

function renderProfile(onNavigate?: () => void) {
  return render(
    <MemoryRouter>
      <SidebarProfile onNavigate={onNavigate} />
    </MemoryRouter>,
  )
}

describe("sidebar profile", () => {
  it("renders a local application brand instead of a remote profile image", () => {
    const { container } = renderProfile()

    expect(screen.getByText("学习系统")).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.queryByText("dieWehmut")).not.toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/github/i)
  })

  it("links the local brand home and reports navigation", () => {
    const onNavigate = vi.fn()
    renderProfile(onNavigate)

    const homeLink = screen.getByRole("link", { name: /回到首页/ })
    expect(homeLink).toHaveAttribute("href", "/")
    fireEvent.click(homeLink)
    expect(onNavigate).toHaveBeenCalledOnce()
  })
})
