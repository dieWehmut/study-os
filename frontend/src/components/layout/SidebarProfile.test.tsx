import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { SidebarProfile } from "./SidebarProfile"

function renderProfile() {
  return render(
    <MemoryRouter>
      <SidebarProfile />
    </MemoryRouter>,
  )
}

describe("sidebar profile", () => {
  it("loads the avatar from GitHub's public endpoint, without credentials", () => {
    renderProfile()

    const avatar = screen.getByRole("img", { name: /头像/ })
    const source = avatar.getAttribute("src") ?? ""
    // 这个端点是公开的：没有 token，没有登录，也就没有任何要保管的东西。
    // 一旦 src 里出现查询串以外的凭据，说明有人把它接到了鉴权流程上。
    expect(source).toMatch(/^https:\/\/avatars\.githubusercontent\.com\//)
    expect(source).not.toMatch(/token|access_token|client_secret/i)
  })

  it("asks for an avatar sized for the slot instead of the original", () => {
    renderProfile()

    // GitHub 默认吐的是 460px 以上的原图。塞进 152px 的圆里，多下来的全是浪费。
    const source = screen.getByRole("img", { name: /头像/ }).getAttribute("src") ?? ""
    expect(source).toContain("s=304")
  })

  it("falls back to an initial when the avatar cannot be fetched", () => {
    // 这是个本地优先的工具，离线是常态而不是故障。头像取不到时留一个破图标，
    // 比没有头像更像是坏了。
    renderProfile()

    fireEvent.error(screen.getByRole("img", { name: /头像/ }))

    expect(screen.queryByRole("img", { name: /头像/ })).not.toBeInTheDocument()
    expect(screen.getByText("D")).toBeInTheDocument()
  })

  it("names the profile and links it home", () => {
    renderProfile()

    expect(screen.getByText("dieWehmut")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /回到首页/ })).toHaveAttribute("href", "/")
  })
})
