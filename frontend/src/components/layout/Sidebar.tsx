import { NavList } from "./NavList"
import { SidebarProfile } from "./SidebarProfile"

export function Sidebar() {
  return (
    <aside className="hidden w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:fixed md:inset-y-0 md:flex md:flex-col md:overflow-y-auto">
      <SidebarProfile />
      <NavList label="主导航" />
    </aside>
  )
}
