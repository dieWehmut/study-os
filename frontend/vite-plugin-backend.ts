import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import type { Plugin } from "vite"

const repoRoot = path.resolve(import.meta.dirname, "..")
const binaryName = process.platform === "win32" ? ".dev-backend.exe" : ".dev-backend"
const binaryPath = path.join(repoRoot, binaryName)

async function backendIsHealthy(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(1000),
    })
    return response.ok
  } catch {
    return false
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    )
  })
}

/**
 * Starts the Go backend alongside `vite dev` and stops it on shutdown.
 *
 * The binary is compiled first rather than launched with `go run`, because
 * `go run` holds the server as a grandchild process — killing it would leave
 * the real listener orphaned on the port.
 */
export function backendServer(origin = "http://127.0.0.1:8080"): Plugin {
  let child: ChildProcess | null = null
  let stopping = false

  function stop() {
    if (!child || stopping) return
    stopping = true
    child.kill()
    child = null
  }

  return {
    name: "study-os:backend-server",
    apply: "serve",
    async configureServer(server) {
      if (process.env.VITEST) return

      if (await backendIsHealthy(origin)) {
        server.config.logger.info(`后端已在运行，复用 ${origin}`)
        return
      }

      server.config.logger.info("正在编译后端…")
      try {
        await run("go", ["build", "-o", binaryPath, "./backend"])
      } catch (error) {
        server.config.logger.error(`后端编译失败，请手动启动：${String(error)}`)
        return
      }

      child = spawn(binaryPath, [], { cwd: repoRoot, stdio: "inherit" })
      child.on("exit", (code) => {
        if (!stopping && code !== 0) {
          server.config.logger.error(`后端已退出（code ${code}）`)
        }
        child = null
      })

      server.httpServer?.on("close", stop)
      process.once("exit", stop)
      process.once("SIGINT", stop)
      process.once("SIGTERM", stop)
    },
  }
}
