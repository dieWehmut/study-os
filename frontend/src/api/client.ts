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
