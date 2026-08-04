import { useState } from "react"
import { Waves } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ReviewSession } from "@/features/memory/ReviewSession"

export default function Memory() {
  const [recovery, setRecovery] = useState(false)
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Waves aria-hidden="true" className="size-4 text-primary" />
            <h1 className="font-heading text-2xl font-semibold tracking-tight">记忆检测</h1>
          </div>
          <p className="text-sm text-muted-foreground">只做高频、快捷、无需逻辑思考的检测。</p>
        </div>
        <Button
          type="button"
          variant={recovery ? "default" : "outline"}
          aria-pressed={recovery}
          onClick={() => setRecovery((value) => !value)}
        >
          {recovery ? "恢复模式已开启" : "恢复模式"}
        </Button>
      </div>
      {recovery ? (
        <Badge variant="secondary" className="w-fit">脑雾时只推送低阻力任务（看词回忆 / 四选一猜词）</Badge>
      ) : null}
      <ReviewSession recovery={recovery} />
    </section>
  )
}
