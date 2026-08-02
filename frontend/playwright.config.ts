import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

const backendPort = 8080
const frontendPort = 5174
const repoRoot = path.resolve(import.meta.dirname, "..")
const e2eDataDir = path.join(repoRoot, "frontend", ".e2e-data", `run-${Date.now()}`)

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command: "go build -o backend-e2e.exe ./backend && backend-e2e.exe",
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: repoRoot,
      env: {
        STUDY_OS_DATA_DIR: e2eDataDir,
        STUDY_OS_LISTEN_ADDRESS: `127.0.0.1:${backendPort}`,
        AI_PROVIDER: "mock",
      },
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: import.meta.dirname,
    },
  ],
})
