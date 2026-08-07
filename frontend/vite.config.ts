import path from "node:path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defaultExclude, defineConfig } from "vitest/config"

import { backendServer } from "./vite-plugin-backend"

export default defineConfig({
  plugins: [react(), tailwindcss(), backendServer()],
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
    exclude: [...defaultExclude, "e2e/**"],
  },
})
