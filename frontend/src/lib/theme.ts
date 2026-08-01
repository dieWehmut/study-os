export type Theme = "light" | "dark"

export const themeStorageKey = "study-os-theme"

export function preferredTheme(): Theme {
  const saved = localStorage.getItem(themeStorageKey)
  if (saved === "light" || saved === "dark") return saved
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark")
  document.documentElement.style.colorScheme = theme
}

export function initializeTheme(): Theme {
  const theme = preferredTheme()
  applyTheme(theme)
  return theme
}

export function saveTheme(theme: Theme): void {
  localStorage.setItem(themeStorageKey, theme)
  applyTheme(theme)
}
