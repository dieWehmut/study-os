export type Theme = "light" | "dark"

export const themeStorageKey = "study-os-theme"

export function preferredTheme(): Theme {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(themeStorageKey)
  } catch {
    // Storage can be unavailable (private mode, disabled cookies); fall back to the system.
  }
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
  try {
    localStorage.setItem(themeStorageKey, theme)
  } catch {
    // Persistence is best-effort; the in-memory theme still applies.
  }
  applyTheme(theme)
}
