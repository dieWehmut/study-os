export interface RuntimeEnv {
  VITE_STATIC_DEMO?: string
  BASE_URL?: string
}

export type RouterMode = "browser" | "hash"

function currentEnv(): RuntimeEnv {
  return import.meta.env
}

export function isStaticDemo(env: RuntimeEnv = currentEnv()): boolean {
  return env.VITE_STATIC_DEMO?.trim().toLowerCase() === "true"
}

export function routerMode(env: RuntimeEnv = currentEnv()): RouterMode {
  return isStaticDemo(env) ? "hash" : "browser"
}

export function publicBasePath(env: RuntimeEnv = currentEnv()): string {
  const configured = env.BASE_URL?.trim() ?? ""
  if (!configured || configured === "/") return "/"
  const leading = configured.startsWith("/") ? configured : `/${configured}`
  return leading.endsWith("/") ? leading : `${leading}/`
}
