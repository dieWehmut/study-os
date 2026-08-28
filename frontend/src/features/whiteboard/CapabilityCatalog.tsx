import { useMemo, useState } from "react"
import { Compass, Layers3, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  capabilitiesForTier,
  WHITEBOARD_TIERS,
  type WhiteboardTier,
} from "@/lib/whiteboard-capabilities"

const tierLabels: Record<WhiteboardTier, string> = {
  foundation: "基础体验",
  polish: "增强体验",
  frontier: "进阶能力",
}

const tierIcons: Record<WhiteboardTier, typeof Layers3> = {
  foundation: Layers3,
  polish: Compass,
  frontier: Sparkles,
}

export function CapabilityCatalog() {
  const [tier, setTier] = useState<WhiteboardTier>("foundation")
  const entries = useMemo(() => capabilitiesForTier(tier), [tier])
  return (
    <section aria-labelledby="whiteboard-capability-title" className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Compass aria-hidden="true" className="size-4 text-primary" />
            <h2 id="whiteboard-capability-title" className="text-base font-semibold">白板能力目录</h2>
          </div>
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
            按能力层级整理白板产品线索，并把每项能力翻译成可服务学习的动作。外部资料仍以字幕和可复现样例为准。
          </p>
        </div>
        <div role="group" aria-label="白板能力层级" className="flex flex-wrap gap-1.5">
          {WHITEBOARD_TIERS.map((option) => {
            const Icon = tierIcons[option]
            return (
              <Button
                key={option}
                size="xs"
                variant={tier === option ? "default" : "outline"}
                aria-pressed={tier === option}
                onClick={() => setTier(option)}
              >
                <Icon data-icon="inline-start" />{tierLabels[option]}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map((entry) => (
          <article key={entry.id} className="grid gap-2 rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-medium">{entry.name}</h3>
              <Badge variant="outline">{tierLabels[entry.tier]}</Badge>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{entry.summary}</p>
            <p className="text-sm leading-6">{entry.learningValue}</p>
            <div className="flex flex-wrap gap-1.5">
              {entry.products.map((product) => <Badge key={product} variant="secondary">{product}</Badge>)}
            </div>
            <p className="border-t pt-2 text-[0.7rem] leading-5 text-muted-foreground">{entry.evidence}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
