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
  const response = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw new ApiError(response.status, `请求失败（${response.status}）`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
