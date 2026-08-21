import { useEffect, useState, type ReactNode } from "react"

import { GiscusComments } from "@/features/comments/GiscusComments"
import { cn } from "@/lib/utils"
import { isStaticDemo } from "@/lib/runtime"
import { Header } from "./Header"
import { NavList } from "./NavList"
import { Sidebar } from "./Sidebar"
import { SidebarProfile } from "./SidebarProfile"

const DESKTOP_SIDEBAR_STORAGE_KEY = "study-os.desktop-sidebar-hidden"

function readDesktopSidebarHidden() {
  if (typeof window === "undefined") {
    return false
  }

  try {
    return window.localStorage.getItem(DESKTOP_SIDEBAR_STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [desktopSidebarHidden, setDesktopSidebarHidden] = useState(readDesktopSidebarHidden)

  function toggleDesktopSidebar() {
    const nextHidden = !desktopSidebarHidden
    setDesktopSidebarHidden(nextHidden)
    try {
      window.localStorage.setItem(DESKTOP_SIDEBAR_STORAGE_KEY, String(nextHidden))
    } catch {
      // Restricted browsing contexts may deny storage; the current session still works.
    }
  }

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
      <Sidebar hidden={desktopSidebarHidden} />

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
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:hidden",
          mobileDrawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SidebarProfile onNavigate={() => setMobileDrawerOpen(false)} />
        <NavList label="移动端主导航" onNavigate={() => setMobileDrawerOpen(false)} />
      </aside>

      <div
        data-layout-content
        className={cn(
          "min-h-dvh transition-[padding] duration-200",
          desktopSidebarHidden ? "md:pl-0" : "md:pl-64",
        )}
      >
        <Header
          desktopSidebarHidden={desktopSidebarHidden}
          onDesktopSidebarToggle={toggleDesktopSidebar}
          onMenuToggle={() => setMobileDrawerOpen(!mobileDrawerOpen)}
        />
        {isStaticDemo() ? (
          <div
            role="status"
            data-static-demo="true"
            className="mx-auto mt-3 w-full max-w-7xl px-4 sm:px-6 lg:px-5"
          >
            <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              GitHub Pages 展示模式 · 数据只在当前页面内演示，不会写入后端
            </div>
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-6 sm:px-6 md:pb-10 lg:px-5 lg:pt-8">
          {children}
          <GiscusComments />
        </main>
      </div>
    </div>
  )
}
