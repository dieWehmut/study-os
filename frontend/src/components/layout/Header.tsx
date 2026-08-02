import { useLocation } from "react-router-dom"

import { navigationForPath } from "./navigation"
import { ThemeToggle } from "./ThemeToggle"

export function Header() {
  const { pathname } = useLocation()
  const current = navigationForPath(pathname)

  return (
    <header className="sticky top-0 border-b border-border/80 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <p className="truncate font-heading text-base font-semibold tracking-tight">{current.label}</p>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">{current.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
