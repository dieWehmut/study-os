import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

const backendPort = 8080
const frontendPort = 5174
const repoRoot = path.resolve(import.meta.dirname, "..")
const e2eDataDir = path.join(repoRoot, "frontend", ".e2e-data", `run-${Date.now()}`)
// Absolute, because a bare name only resolves if the shell searches the working
// directory, and cmd.exe skips it whenever NoDefaultCurrentDirectoryInExePath is
// set -- a common hardening setting. Relying on that lookup made the documented
// `pnpm run e2e` die on a clean checkout with "not recognized as an internal or
// external command", before a single test ran.
const backendBinary = path.join(repoRoot, "backend-e2e.exe")

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  // The same lesson as testTimeout in vite.config.ts and asyncUtilTimeout in
  // src/test/setup.tsx, one layer further out: a per-assertion stopwatch of 5s is
  // a stopwatch on the machine. When the whole sweep runs -- go tests, 124 vitest
  // files, a build, then this -- an assertion can miss 5s on a step that takes
  // 200ms on an idle desktop, and the suite blames a different test each time.
  // Raised after exactly that: one sweep failed this suite on
  // qa-record-queue.spec.ts, which then passed on its own, twice.
  expect: { timeout: 15_000 },
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
      command: `go build -o "${backendBinary}" ./backend && "${backendBinary}"`,
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: repoRoot,
      env: {
        STUDY_OS_DATA_DIR: e2eDataDir,
        STUDY_OS_LISTEN_ADDRESS: `127.0.0.1:${backendPort}`,
        AI_ACTIVE_PROVIDER: "mock",
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
