interface LocationLike {
  protocol: string
  hostname: string
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1"
}

export function shouldRegisterServiceWorker(
  location: LocationLike = globalThis.location,
  secureContext = typeof window !== "undefined" ? window.isSecureContext : false,
): boolean {
  if (location.protocol === "https:") return secureContext
  return location.protocol === "http:" && isLocalHost(location.hostname)
}

export async function registerServiceWorker(
  options: { enabled?: boolean } = {},
): Promise<ServiceWorkerRegistration | undefined> {
  const enabled = options.enabled ?? import.meta.env.PROD
  if (
    !enabled ||
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    !shouldRegisterServiceWorker(window.location)
  ) return undefined

  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" })
  } catch {
    // Offline/PWA support is optional; the app remains usable when registration fails.
    return undefined
  }
}
