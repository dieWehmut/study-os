import { useEffect, useState, type CSSProperties, type ReactNode } from "react"

import { readSavedSidebarWidth, SIDEBAR_WIDTH_KEY } from "@/lib/sidebar"
import { cn } from "@/lib/utils"
import { Header } from "./Header"
import { MobileNav } from "./MobileNav"
import { NavList } from "./NavList"
import { Sidebar } from "./Sidebar"

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState(readSavedSidebarWidth)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    if (mobileDrawerOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [mobileDrawerOpen])

  return (
    <div className="min-h-dvh bg-background">
      {/* Desktop Sidebar */}
      <Sidebar width={sidebarWidth} onWidthChange={setSidebarWidth} />

      {/* Mobile Drawer Overlay */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileDrawerOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <aside
        aria-hidden={!mobileDrawerOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:hidden",
          mobileDrawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <NavList label="移动端主导航" onNavigate={() => setMobileDrawerOpen(false)} />
      </aside>

      <div
        className="min-h-dvh md:pl-(--sidebar-width)"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <Header onMenuToggle={() => setMobileDrawerOpen(!mobileDrawerOpen)} />
        <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 md:pb-10 lg:px-8 lg:pt-8">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  )
}
