import { Moon, Sun } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { initializeTheme, saveTheme, type Theme } from "@/lib/theme"

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initializeTheme)
  const nextTheme: Theme = theme === "dark" ? "light" : "dark"

  function toggleTheme() {
    saveTheme(nextTheme)
    setTheme(nextTheme)
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-primary/40 hover:bg-primary/10 hover:text-primary hover:shadow-sm active:translate-y-0 active:scale-95"
      aria-label={`切换到${nextTheme === "dark" ? "暗色" : "亮色"}模式`}
      title={`切换到${nextTheme === "dark" ? "暗色" : "亮色"}模式`}
      onClick={toggleTheme}
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" className="transition-transform duration-200 group-hover/button:rotate-12 group-hover/button:scale-110" />
      ) : (
        <Moon aria-hidden="true" className="transition-transform duration-200 group-hover/button:rotate-12 group-hover/button:scale-110" />
      )}
    </Button>
  )
}
