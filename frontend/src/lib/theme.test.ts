import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyTheme, initializeTheme, preferredTheme, saveTheme, themeStorageKey } from "./theme"

describe("theme persistence", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("dark")
    document.documentElement.style.colorScheme = ""
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("follows the system dark preference when nothing is saved", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))

    expect(preferredTheme()).toBe("dark")
    expect(initializeTheme()).toBe("dark")
    expect(document.documentElement).toHaveClass("dark")
  })

  it("prefers the saved theme over the system preference", () => {
    localStorage.setItem(themeStorageKey, "light")
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))

    expect(preferredTheme()).toBe("light")
  })

  it("applies the theme class and color-scheme", () => {
    applyTheme("dark")

    expect(document.documentElement).toHaveClass("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")
  })

  it("falls back to the system preference when storage reads throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied")
    })
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))

    expect(() => initializeTheme()).not.toThrow()
    expect(preferredTheme()).toBe("dark")
  })

  it("still applies the theme when saving to storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded")
    })

    expect(() => saveTheme("dark")).not.toThrow()
    expect(document.documentElement).toHaveClass("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")
  })
})
