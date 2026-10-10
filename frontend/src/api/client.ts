interface WailsDesktopBridge {
  APIBaseURL(): Promise<string>
  APIToken(): Promise<string>
}

declare global {
  interface Window {
    __STUDY_OS_API_BASE__?: string
    go?: {
      main?: {
        DesktopApp?: WailsDesktopBridge
      }
    }
  }
}

export interface ApiConfig {
  baseUrl: string
  token?: string
}

function withApiPath(base: string): string {
  const normalized = base.trim().replace(/\/+$/, "")
  if (!normalized) return "/api"
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`
}

export function resolveApiBase(): string {
  const desktopBase = window.__STUDY_OS_API_BASE__
  if (desktopBase) return withApiPath(desktopBase)

  const configuredBase = import.meta.env.VITE_API_BASE_URL
  if (configuredBase) return withApiPath(configuredBase)

  return "/api"
}

export async function resolveApiConfig(): Promise<ApiConfig> {
  const bridge = window.go?.main?.DesktopApp
  if (!bridge) return { baseUrl: resolveApiBase() }

  const [baseUrl, token] = await Promise.all([
    bridge.APIBaseURL(),
    bridge.APIToken(),
  ])

  return { baseUrl: withApiPath(baseUrl), token }
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (isStaticDemo()) {
    try {
      return await staticDemoRequest<T>(path, init)
    } catch (error) {
      if (error instanceof StaticDemoError) {
        throw new ApiError(error.status, error.message)
      }
      throw error
    }
  }

  const { baseUrl, token } = await resolveApiConfig()
  const headers = new Headers(init?.headers)
  if (!headers.has("Accept")) headers.set("Accept", "application/json")
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`)
  if (init?.body && !(typeof FormData !== "undefined" && init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  // Keep a plain object so callers and tests can inspect auth headers while
  // normalizing the browser's case-insensitive header names exactly once.
  const requestHeaders: Record<string, string> = {}
  headers.forEach((value, key) => {
    switch (key.toLowerCase()) {
      case "accept":
        requestHeaders.Accept = value
        break
      case "authorization":
        requestHeaders.Authorization = value
        break
      case "content-type":
        requestHeaders["Content-Type"] = value
        break
      default:
        requestHeaders[key] = value
    }
  })

  const response = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers: requestHeaders,
  })

  if (!response.ok) {
    let message = `请求失败（${response.status}）`
    const text = await response.text()
    if (text) {
      try {
        const payload: unknown = JSON.parse(text)
        if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
          message = payload.error
        } else {
          message = text
        }
      } catch {
        message = text
      }
    }
    throw new ApiError(response.status, message)
  }

  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** The filename a server suggested, when it suggested one. */
export function filenameFromDisposition(disposition: string | null): string {
  if (!disposition) return ""
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition)
  if (!match) return ""
  try {
    return decodeURIComponent(match[1].trim().replace(/"$/, ""))
  } catch {
    return match[1].trim().replace(/"$/, "")
  }
}

/**
 * One request that is not JSON: a file the reader asked to keep.
 *
 * It goes through `resolveApiConfig` for the same reason `apiRequest` does -- the
 * desktop shell authenticates with a token, and a plain `<a href>` (or a bare
 * `fetch` to `resolveApiBase`) would arrive without it.
 */
export async function apiRequestBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fileRequest(path)
  return { blob: await response.blob(), filename: filenameFromDisposition(response.headers.get("Content-Disposition")) }
}

/** The same authenticated request, for a file that is plain text (a CSV export). */
export async function apiRequestText(path: string): Promise<string> {
  return (await fileRequest(path)).text()
}

async function fileRequest(path: string): Promise<Response> {
  if (isStaticDemo()) throw new ApiError(404, "GitHub Pages 展示模式没有本地文件")
  const { baseUrl, token } = await resolveApiConfig()
  const headers = new Headers()
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const response = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, { headers })
  if (!response.ok) {
    // The same envelope `apiRequest` unwraps: without this the reader is shown
    // `{"error":"备份文件已经不在了…"}` instead of the sentence inside it.
    const text = (await response.text()).trim()
    let message = text || `下载失败（${response.status}）`
    try {
      const payload: unknown = JSON.parse(text)
      if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error
      }
    } catch {
      // Not JSON: whatever the server said is the message.
    }
    throw new ApiError(response.status, message)
  }
  return response
}
import { StaticDemoError, staticDemoRequest } from "./static-demo"
import { isStaticDemo } from "@/lib/runtime"
