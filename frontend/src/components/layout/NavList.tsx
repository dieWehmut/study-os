import { NavLink } from "react-router-dom"

import { cn } from "@/lib/utils"
import { primaryNavigation } from "./navigation"

interface NavListProps {
  onNavigate?: () => void
  label: string
}

export function NavList({ onNavigate, label }: NavListProps) {
  return (
    <nav aria-label={label} className="flex flex-1 flex-col gap-1 px-3 py-3">
      {primaryNavigation.map(({ icon: Icon, label: itemLabel, path }) => (
        <NavLink
          key={path}
          to={path}
          end={path === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group flex min-h-[42px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              isActive && "bg-sidebar-accent text-sidebar-primary shadow-sm",
            )
          }
        >
          <Icon aria-hidden="true" className="size-[18px] shrink-0" />
          <span className="truncate">{itemLabel}</span>
        </NavLink>
      ))}
    </nav>
  )
}
