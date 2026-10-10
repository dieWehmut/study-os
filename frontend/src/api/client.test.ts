import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiRequest, apiRequestBlob, filenameFromDisposition, resolveApiBase, resolveApiConfig } from "./client"

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

describe("filenameFromDisposition", () => {
  it("reads the plain quoted name the server sends", () => {
    // The backup download names the reader's file from here: a parser that
    // missed it would hand them "study-os-backup.db" for every backup.
    expect(filenameFromDisposition('attachment; filename="study-daily-20261010-000001.db"')).toBe(
      "study-daily-20261010-000001.db",
    )
  })

  it("reads the encoded form too", () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E9%94%99%E9%A2%98.csv")).toBe("错题.csv")
  })

  it("answers with nothing rather than throwing on what it cannot read", () => {
    // A missing header, a bare attachment, and a broken escape all leave the
    // caller to pick its own name instead of failing the download.
    expect(filenameFromDisposition(null)).toBe("")
    expect(filenameFromDisposition("attachment")).toBe("")
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%ZZ")).toBe("%ZZ")
  })
})

describe("apiRequestBlob", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("brings back the bytes and the server's filename", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response("SQLite format 3\u0000", {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.sqlite3",
          "Content-Disposition": 'attachment; filename="study-daily.db"',
        },
      }),
    )

    const { blob, filename } = await apiRequestBlob("/backups/b-1/download")

    expect(filename).toBe("study-daily.db")
    expect(blob.size).toBeGreaterThan(0)
  })

  it("turns a refusal into the same error contract the JSON calls use", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "备份文件已经不在了，列表会在下次刷新时更新" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await expect(apiRequestBlob("/backups/b-1/download")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "备份文件已经不在了，列表会在下次刷新时更新",
    })
  })
})
