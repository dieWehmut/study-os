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

  it("leaves multipart headers to the browser for FormData bodies", async () => {
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ job_id: "job-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const body = new FormData()
    body.append("file", new File(["term,definition\nhello,你好\n"], "words.csv", { type: "text/csv" }))

    await apiRequest<{ job_id: string }>("/imports", { method: "POST", body })

    const [, request] = fetchSpy.mock.calls[0]
    const headers = new Headers(request?.headers)
    expect(headers.get("Accept")).toBe("application/json")
    expect(headers.get("Content-Type")).toBeNull()
  })

  it("surfaces a JSON error returned by the API", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "term and definition are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await expect(apiRequest("/imports/job-1/preview", { method: "POST", body: "{}" })).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "term and definition are required",
    })
  })

  it("uses in-memory fixtures and never fetches in static demo mode", async () => {
    vi.stubEnv("VITE_STATIC_DEMO", "true")
    const fetchSpy = vi.spyOn(window, "fetch")

    await expect(apiRequest<{ knowledge_count: number }>("/dashboard")).resolves.toMatchObject({
      knowledge_count: expect.any(Number),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("normalizes static demo failures to the shared API error contract", async () => {
    vi.stubEnv("VITE_STATIC_DEMO", "true")

    await expect(apiRequest("/chat/records/missing-session")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    })
  })
})
