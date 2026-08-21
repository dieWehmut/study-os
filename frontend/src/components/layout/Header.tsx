import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Breadcrumb } from "./Breadcrumb"
import { ThemeToggle } from "./ThemeToggle"

interface HeaderProps {
  desktopSidebarHidden: boolean
  onDesktopSidebarToggle: () => void
  onMenuToggle: () => void
}

export function Header({
  desktopSidebarHidden,
  onDesktopSidebarToggle,
  onMenuToggle,
}: HeaderProps) {
  const SidebarIcon = desktopSidebarHidden ? PanelLeftOpen : PanelLeftClose
  const sidebarLabel = desktopSidebarHidden ? "显示侧栏" : "隐藏侧栏"

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-12 max-w-7xl items-center gap-2 px-3 sm:px-6 lg:px-5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 md:hidden"
          aria-label="打开导航菜单"
          onClick={onMenuToggle}
        >
          <Menu aria-hidden="true" className="size-5" />
        </Button>

        <Breadcrumb />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hidden size-9 shrink-0 md:inline-flex"
          aria-label={sidebarLabel}
          aria-controls="desktop-sidebar"
          aria-expanded={!desktopSidebarHidden}
          title={sidebarLabel}
          onClick={onDesktopSidebarToggle}
        >
          <SidebarIcon aria-hidden="true" className="size-5" />
        </Button>

        <ThemeToggle />
      </div>
    </header>
  )
}
