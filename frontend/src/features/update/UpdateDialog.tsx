import { useEffect, useState } from "react"
import { DownloadCloud, RefreshCw } from "lucide-react"

import { applyUpdate, getUpdateStatus, type UpdateStatus } from "@/api/update"
import { Button } from "@/components/ui/button"
import { isStaticDemo } from "@/lib/runtime"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function UpdateDialog() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    getUpdateStatus()
      .then((value) => {
        if (!active) return
        setStatus(value)
        if (value.update_available) setOpen(true)
      })
      .catch(() => {
        // 更新检查失败不打扰学习。
      })
    return () => {
      active = false
    }
  }, [])

  async function startUpdate() {
    if (isStaticDemo()) {
      setOpen(false)
      return
    }
    setApplying(true)
    setError("")
    try {
      await applyUpdate()
      const started = Date.now()
      const timer = window.setInterval(async () => {
        if (Date.now() - started > 180_000) {
          window.clearInterval(timer)
          setApplying(false)
          setError("更新后服务未恢复，请稍后手动打开。")
          return
        }
        try {
          const response = await fetch("/api/health")
          if (response.ok) {
            window.clearInterval(timer)
            window.location.reload()
          }
        } catch {
          // 服务正在重启，继续等待。
        }
      }, 2000)
    } catch {
      setApplying(false)
      setError("更新失败，请检查网络后重试。")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>发现新版本 {status?.latest_version ?? ""}</DialogTitle>
          <DialogDescription>
            当前版本 {status?.current_version ?? ""}，是否立即更新？
          </DialogDescription>
        </DialogHeader>
        {status?.release_notes ? (
          <div className="max-h-48 overflow-auto rounded-lg border bg-muted/35 p-3 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
            {status.release_notes}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter showCloseButton={false}>
          <Button variant="outline" disabled={applying} onClick={() => setOpen(false)}>稍后</Button>
          <Button disabled={applying} onClick={() => void startUpdate()}>
            {applying ? <RefreshCw aria-hidden="true" className="animate-spin" /> : <DownloadCloud data-icon="inline-start" />}
            {applying ? "正在后台更新…" : "立即更新"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
