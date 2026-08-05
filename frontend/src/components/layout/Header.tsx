import { Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Breadcrumb } from "./Breadcrumb"
import { ThemeToggle } from "./ThemeToggle"

interface HeaderProps {
  onMenuToggle: () => void
}

export function Header({ onMenuToggle }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-12 max-w-7xl items-center gap-2 px-3 sm:px-6 lg:px-8">
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

        <ThemeToggle />
      </div>
    </header>
  )
}
