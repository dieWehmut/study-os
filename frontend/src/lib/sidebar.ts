export const SIDEBAR_MIN_WIDTH = 208
export const SIDEBAR_MAX_WIDTH = 360
export const SIDEBAR_DEFAULT_WIDTH = 256
export const SIDEBAR_WIDTH_KEY = "study-os.sidebar-width"

export function readSavedSidebarWidth(): number {
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  if (Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) {
    return Math.round(saved)
  }
  return SIDEBAR_DEFAULT_WIDTH
}
