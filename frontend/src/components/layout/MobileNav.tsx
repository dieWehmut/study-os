import { NavLink } from "react-router-dom"

import { cn } from "@/lib/utils"
import { primaryNavigation } from "./navigation"

export function MobileNav() {
  return (
    <nav
      aria-label="移动导航"
      className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_32px_-26px_hsl(var(--foreground)/0.45)] backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
        {primaryNavigation.map(({ icon: Icon, label, path }) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            className={({ isActive }) =>
              cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[0.68rem] font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive && "bg-primary/10 text-primary",
              )
            }
          >
            <Icon aria-hidden="true" className="size-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
