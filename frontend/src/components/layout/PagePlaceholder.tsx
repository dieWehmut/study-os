import type { LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface PagePlaceholderProps {
  description: string
  eyebrow: string
  icon: LucideIcon
  title: string
}

export function PagePlaceholder({
  description,
  eyebrow,
  icon: Icon,
  title,
}: PagePlaceholderProps) {
  return (
    <section className="grid gap-6">
      <div className="grid gap-3">
        <Badge variant="secondary">{eyebrow}</Badge>
        <div className="grid max-w-2xl gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">{description}</p>
        </div>
      </div>
      <Card className="max-w-3xl border-border/80 bg-card/75 shadow-sm">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon aria-hidden="true" className="size-5" />
          </div>
          <CardTitle>功能正在接入</CardTitle>
          <CardDescription>应用骨架已经就位，此区域将连接本地学习数据与工作流。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-24 rounded-xl border border-dashed border-border bg-muted/35" aria-hidden="true" />
        </CardContent>
      </Card>
    </section>
  )
}
