import { ChevronRight } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { cn } from "@/lib/utils"
import { navigationForPath } from "./navigation"

interface BreadcrumbProps {
  className?: string
}

export function Breadcrumb({ className }: BreadcrumbProps) {
  const location = useLocation()

  // 首页 has no crumb on purpose: you are already at 学习 OS, so a crumb would only repeat it.
  // The spacer is not an oversight -- it keeps the row full-width so the buttons on the right
  // stay put. It is the crumb that is absent, not the header.
  if (location.pathname === "/") {
    return <div className="flex-1" />
  }

  const current = navigationForPath(location.pathname)

  return (
    <nav
      aria-label="当前位置"
      className={cn(
        "flex min-w-0 flex-1 items-center gap-0.5 text-xs font-semibold text-muted-foreground sm:text-sm",
        className,
      )}
    >
      <Link
        to="/"
        className="shrink-0 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-primary/10 hover:text-primary"
      >
        学习 OS
      </Link>
      <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
      <span className="truncate px-1.5 py-0.5 text-foreground" aria-current="page">
        {current.label}
      </span>
    </nav>
  )
}
