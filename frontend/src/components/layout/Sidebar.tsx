import { cn } from "@/lib/utils"
import { NavList } from "./NavList"
import { SidebarProfile } from "./SidebarProfile"

interface SidebarProps {
  hidden?: boolean
}

export function Sidebar({ hidden = false }: SidebarProps) {
  return (
    <aside
      id="desktop-sidebar"
      aria-hidden={hidden}
      className={cn(
        "hidden w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        hidden
          ? "md:hidden"
          : "md:fixed md:inset-y-0 md:flex md:flex-col md:overflow-y-auto",
      )}
    >
      <SidebarProfile />
      <NavList label="主导航" />
    </aside>
  )
}
