import type { PointerEvent, KeyboardEvent } from "react"
import { NavLink } from "react-router-dom"

import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/sidebar"
import { cn } from "@/lib/utils"
import { primaryNavigation } from "./navigation"

interface SidebarProps {
  width: number
  onWidthChange: (width: number) => void
}

export function Sidebar({ width, onWidthChange }: SidebarProps) {
  function clampWidth(value: number): number {
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    onWidthChange(clampWidth(event.clientX))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null
    switch (event.key) {
      case "ArrowRight":
        next = clampWidth(width + 16)
        break
      case "ArrowLeft":
        next = clampWidth(width - 16)
        break
      case "Home":
        next = SIDEBAR_DEFAULT_WIDTH
        break
    }
    if (next !== null) {
      event.preventDefault()
      onWidthChange(next)
    }
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className="relative hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:fixed md:inset-y-0 md:flex md:flex-col"
    >
      <div className="flex h-20 items-center gap-3 px-6">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
          S
        </div>
        <div className="min-w-0">
          <p className="font-heading text-sm font-semibold tracking-tight">Study OS</p>
        </div>
      </div>

      <nav aria-label="主导航" className="flex flex-1 flex-col gap-1 px-3 py-3">
        {primaryNavigation.map(({ icon: Icon, label, path }) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isActive && "bg-sidebar-accent font-medium text-sidebar-primary shadow-sm",
              )
            }
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="px-6 pb-6">
        <div className="rounded-xl border border-sidebar-border bg-background/65 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            本地优先
          </div>
          <p className="mt-1 text-[0.68rem] leading-4 text-muted-foreground">
            学习记录保存在本机，离线仍可继续。
          </p>
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        onKeyDown={handleKeyDown}
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none outline-none hover:bg-primary/30 focus-visible:bg-primary/50 focus-visible:ring-2 focus-visible:ring-ring/60 active:bg-primary/60"
      />
    </aside>
  )
}
