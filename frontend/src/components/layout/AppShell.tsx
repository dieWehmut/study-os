import { useEffect, useState, type ReactNode } from "react"

import { GiscusComments } from "@/features/comments/GiscusComments"
import { cn } from "@/lib/utils"
import { isStaticDemo } from "@/lib/runtime"
import { Header } from "./Header"
import { NavList } from "./NavList"
import { Sidebar } from "./Sidebar"
import { SidebarProfile } from "./SidebarProfile"

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
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:hidden",
          mobileDrawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SidebarProfile onNavigate={() => setMobileDrawerOpen(false)} />
        <NavList label="移动端主导航" onNavigate={() => setMobileDrawerOpen(false)} />
      </aside>

      {/* 这里的 pl 必须和 Sidebar 的 w-64 对齐：侧栏是 fixed 的，不占文档流，
          正文得自己让出那一栏的位置。 */}
      <div className="min-h-dvh md:pl-64">
        <Header onMenuToggle={() => setMobileDrawerOpen(!mobileDrawerOpen)} />
        {isStaticDemo() ? (
          <div
            role="status"
            data-static-demo="true"
            className="mx-auto mt-3 w-full max-w-7xl px-4 sm:px-6 lg:px-8"
          >
            <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              GitHub Pages 展示模式 · 数据只在当前页面内演示，不会写入后端
            </div>
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-6 sm:px-6 md:pb-10 lg:px-8 lg:pt-8">
          {children}
          <GiscusComments />
        </main>
      </div>
    </div>
  )
}
