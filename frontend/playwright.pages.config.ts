import { defineConfig, devices } from "@playwright/test"

export type PagesServer = "dev" | "preview"

export interface PagesHarnessOptions {
  basePath?: string
  host?: string
  port?: string | number
  preview?: string | boolean
  server?: string
}

export interface PagesHarness {
  basePath: string
  baseURL: string
  command: string
  host: string
  port: number
  server: PagesServer
}

export function normalizePagesBasePath(value?: string): string {
  const configured = value === undefined ? "/study-os/" : value.trim()
  if (!configured || configured === "/") return "/"
  const leading = configured.startsWith("/") ? configured : `/${configured}`
  return leading.endsWith("/") ? leading : `${leading}/`
}

function resolvePort(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : 5_188
}

export function resolvePagesHarness(options: PagesHarnessOptions = {}): PagesHarness {
  const basePath = normalizePagesBasePath(options.basePath)
  const host = options.host?.trim() || "127.0.0.1"
  const port = resolvePort(options.port)
  const preview = options.preview === true || String(options.preview).trim().toLowerCase() === "true"
  const server: PagesServer = options.server?.trim().toLowerCase() === "preview" || preview ? "preview" : "dev"
  const command = server === "preview"
    ? `pnpm exec vite preview --host ${host} --port ${port} --strictPort`
    : `pnpm exec vite --host ${host} --port ${port} --strictPort`

  return {
    basePath,
    baseURL: `http://${host}:${port}${basePath}`,
    command,
    host,
    port,
    server,
  }
}

const pagesHarness = resolvePagesHarness({
  basePath: process.env.VITE_BASE_PATH,
  host: process.env.PAGES_E2E_HOST,
  port: process.env.PAGES_E2E_PORT,
  preview: process.env.PAGES_PREVIEW,
  server: process.env.PAGES_E2E_SERVER,
})

export default defineConfig({
  testDir: "./e2e-pages",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: pagesHarness.baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "pages-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: pagesHarness.command,
    url: pagesHarness.baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    cwd: import.meta.dirname,
    env: {
      VITE_STATIC_DEMO: "true",
      VITE_BASE_PATH: pagesHarness.basePath,
    },
  },
})
