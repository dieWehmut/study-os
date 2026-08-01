import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiRequest, resolveApiBase, resolveApiConfig } from "./client"

describe("resolveApiBase", () => {
  const originalBridge = window.__STUDY_OS_API_BASE__

  beforeEach(() => {
    delete window.__STUDY_OS_API_BASE__
    delete window.go
    vi.stubEnv("VITE_API_BASE_URL", "")
  })

  afterEach(() => {
    if (originalBridge) window.__STUDY_OS_API_BASE__ = originalBridge
    else delete window.__STUDY_OS_API_BASE__
    delete window.go
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("uses a browser-relative API path by default", () => {
    expect(resolveApiBase()).toBe("/api")
  })

  it("uses the Wails runtime bridge when a desktop API address is provided", () => {
    window.__STUDY_OS_API_BASE__ = "http://127.0.0.1:43123/"

    expect(resolveApiBase()).toBe("http://127.0.0.1:43123/api")
  })

  it("normalizes an explicit environment API address", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://study.example.test")

    expect(resolveApiBase()).toBe("https://study.example.test/api")
  })

  it("resolves the Wails API address and bearer token from its async bridge", async () => {
    window.go = {
      main: {
        DesktopApp: {
          APIBaseURL: vi.fn().mockResolvedValue("http://127.0.0.1:43123"),
          APIToken: vi.fn().mockResolvedValue("desktop-token"),
        },
      },
    }

    await expect(resolveApiConfig()).resolves.toEqual({
      baseUrl: "http://127.0.0.1:43123/api",
      token: "desktop-token",
    })
  })

  it("attaches the Wails bearer token to API requests", async () => {
    window.go = {
      main: {
        DesktopApp: {
          APIBaseURL: vi.fn().mockResolvedValue("http://127.0.0.1:43123"),
          APIToken: vi.fn().mockResolvedValue("desktop-token"),
        },
      },
    }
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await apiRequest<{ status: string }>("/health")

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer desktop-token",
        }),
      }),
    )
  })
})
