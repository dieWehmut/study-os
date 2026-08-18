import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerServiceWorker, shouldRegisterServiceWorker } from "./pwa"

describe("PWA registration", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("allows HTTPS and local development origins only", () => {
    expect(
      shouldRegisterServiceWorker({ protocol: "https:", hostname: "study.example" }, true),
    ).toBe(true)
    expect(
      shouldRegisterServiceWorker({ protocol: "http:", hostname: "localhost" }, true),
    ).toBe(true)
    expect(
      shouldRegisterServiceWorker({ protocol: "http:", hostname: "192.168.1.5" }, true),
    ).toBe(false)
    expect(
      shouldRegisterServiceWorker({ protocol: "http:", hostname: "localhost" }, false),
    ).toBe(true)
    expect(
      shouldRegisterServiceWorker({ protocol: "https:", hostname: "study.example" }, false),
    ).toBe(false)
  })

  it("registers the shell worker and returns undefined when registration fails", async () => {
    const register = vi.fn().mockResolvedValue({ scope: "/" })
    vi.stubGlobal("navigator", { serviceWorker: { register } })
    vi.stubGlobal("location", { protocol: "http:", hostname: "localhost" })

    await expect(registerServiceWorker({ enabled: true })).resolves.toEqual({ scope: "/" })
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" })

    register.mockRejectedValueOnce(new Error("unsupported"))
    await expect(registerServiceWorker({ enabled: true })).resolves.toBeUndefined()
  })

  it("does not register during development unless explicitly enabled", async () => {
    const register = vi.fn().mockResolvedValue({ scope: "/" })
    vi.stubGlobal("navigator", { serviceWorker: { register } })
    vi.stubGlobal("location", { protocol: "http:", hostname: "localhost" })

    await expect(registerServiceWorker()).resolves.toBeUndefined()
    expect(register).not.toHaveBeenCalled()
  })

  it("does not register a root-scoped worker for the Pages static demo", async () => {
    const register = vi.fn().mockResolvedValue({ scope: "/study-os/" })
    vi.stubGlobal("navigator", { serviceWorker: { register } })
    vi.stubGlobal("location", { protocol: "https:", hostname: "diewehmut.github.io" })

    await expect(registerServiceWorker({ enabled: true, staticDemo: true })).resolves.toBeUndefined()
    expect(register).not.toHaveBeenCalled()
  })
})
