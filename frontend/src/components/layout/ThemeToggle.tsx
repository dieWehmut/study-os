import { Moon, Sun } from "lucide-react"
import { useState } from "react"

import { initializeTheme, saveTheme, type Theme } from "@/lib/theme"

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initializeTheme)
  const nextTheme: Theme = theme === "dark" ? "light" : "dark"

  function toggleTheme() {
    saveTheme(nextTheme)
    setTheme(nextTheme)
  }

  return (
    <button
      type="button"
      aria-label={`切换到${nextTheme === "dark" ? "暗色" : "亮色"}模式`}
      title={`切换到${nextTheme === "dark" ? "暗色" : "亮色"}模式`}
      onClick={toggleTheme}
      className="inline-grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-foreground shadow-sm transition-all duration-180 hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" className="size-[18px]" />
      ) : (
        <Moon aria-hidden="true" className="size-[18px]" />
      )}
    </button>
  )
}
