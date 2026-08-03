import { useEffect, useState, type CSSProperties, type ReactNode } from "react"

import { readSavedSidebarWidth, SIDEBAR_WIDTH_KEY } from "@/lib/sidebar"
import { Header } from "./Header"
import { MobileNav } from "./MobileNav"
import { Sidebar } from "./Sidebar"

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState(readSavedSidebarWidth)

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  return (
    <div className="min-h-dvh bg-background">
      <Sidebar width={sidebarWidth} onWidthChange={setSidebarWidth} />
      <div
        className="min-h-dvh md:pl-(--sidebar-width)"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <Header />
        <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 md:pb-10 lg:px-8 lg:pt-8">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  )
}
