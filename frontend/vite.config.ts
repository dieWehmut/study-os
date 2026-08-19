import path from "node:path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defaultExclude, defineConfig } from "vitest/config"

import { backendServer } from "./vite-plugin-backend.ts"

function normalizeBasePath(value: string | undefined): string {
  const configured = value?.trim() ?? ""
  if (!configured || configured === "/") return "/"
  const leading = configured.startsWith("/") ? configured : `/${configured}`
  return leading.endsWith("/") ? leading : `${leading}/`
}

const staticDemo = process.env.VITE_STATIC_DEMO === "true"

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  plugins: [react(), tailwindcss(), ...(staticDemo ? [] : [backendServer()])],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.tsx",
    css: true,
    exclude: [...defaultExclude, "e2e/**", "e2e-pages/**"],
    // Vitest's 5s default is a stopwatch on the machine, not on the code. The
    // page-level tests render a whole route through Base UI into jsdom, and
    // when several workers do that at once the slowest of them lands just past
    // 5s -- so the suite reported a different pair of "failures" every run
    // while every file passed in isolation. A suite that cannot say the same
    // thing twice cannot verify anything, so give the slow ones room; a real
    // hang still trips the limit, four times later.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
