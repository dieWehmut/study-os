import { NavLink } from "react-router-dom"

import { cn } from "@/lib/utils"
import { primaryNavigation } from "./navigation"

export function Sidebar() {
  return (
    <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col">
      <div className="flex h-20 items-center gap-3 px-6">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
          S
        </div>
        <div className="min-w-0">
          <p className="font-heading text-sm font-semibold tracking-tight">Study OS</p>
          <p className="truncate text-xs text-muted-foreground">你的自学工作台</p>
        </div>
      </div>

      <nav aria-label="主导航" className="flex flex-1 flex-col gap-1 px-3 py-3">
        {primaryNavigation.map(({ description, icon: Icon, label, path }) => (
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
            <span className="min-w-0">
              <span className="block leading-5">{label}</span>
              <span className="block truncate text-[0.68rem] font-normal text-muted-foreground/80">
                {description}
              </span>
            </span>
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
    </aside>
  )
}
