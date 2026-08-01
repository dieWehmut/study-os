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
      aria-label={`切换到${nextTheme === "dark" ? "暗色" : "亮色"}模式`}
      title={`切换到${nextTheme === "dark" ? "暗色" : "亮色"}模式`}
      onClick={toggleTheme}
    >
      {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  )
}
