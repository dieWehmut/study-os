import type { ReactNode } from "react"

import { Header } from "./Header"
import { MobileNav } from "./MobileNav"
import { Sidebar } from "./Sidebar"

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh bg-background">
      <Sidebar />
      <div className="min-h-dvh md:pl-64">
        <Header />
        <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 md:pb-10 lg:px-8 lg:pt-8">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  )
}
