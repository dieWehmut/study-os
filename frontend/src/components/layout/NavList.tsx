import { NavLink } from "react-router-dom"

import { cn } from "@/lib/utils"
import { primaryNavigation } from "./navigation"

interface NavListProps {
  onNavigate?: () => void
  label: string
}

export function NavList({ onNavigate, label }: NavListProps) {
  return (
    <nav aria-label={label} className="mt-2.5 flex flex-1 flex-col gap-1 px-3">
      {primaryNavigation.map(({ icon: Icon, label: itemLabel, path }) => (
        <NavLink
          key={path}
          to={path}
          end={path === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg px-3 text-sm font-extrabold leading-snug text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary focus-visible:bg-primary/10 focus-visible:text-primary focus-visible:outline-none",
              isActive && "bg-primary/10 text-primary",
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
