import { useEffect, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"
import { Header } from "./Header"
import { NavList } from "./NavList"
import { Sidebar } from "./Sidebar"

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

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
      <Sidebar />

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
          "fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:hidden",
          mobileDrawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <NavList label="移动端主导航" onNavigate={() => setMobileDrawerOpen(false)} />
      </aside>

      {/* 这里的 pl 必须和 Sidebar 的 w-64 对齐：侧栏是 fixed 的，不占文档流，
          正文得自己让出那一栏的位置。 */}
      <div className="min-h-dvh md:pl-64">
        <Header onMenuToggle={() => setMobileDrawerOpen(!mobileDrawerOpen)} />
        <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-6 sm:px-6 md:pb-10 lg:px-8 lg:pt-8">
          {children}
        </main>
      </div>
    </div>
  )
}
