import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e-pages",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5188/study-os/",
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
    command: "pnpm exec vite --host 127.0.0.1 --port 5188 --strictPort",
    url: "http://127.0.0.1:5188/study-os/",
    reuseExistingServer: false,
    timeout: 120_000,
    cwd: import.meta.dirname,
    env: {
      VITE_STATIC_DEMO: "true",
      VITE_BASE_PATH: "/study-os/",
    },
  },
})
