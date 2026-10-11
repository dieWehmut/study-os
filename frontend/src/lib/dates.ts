/**
 * One date, one reading of it.
 *
 * Two features had grown their own copy of this (the article library and the settings
 * panel); a third was about to. The awkward input is the one that matters: rows carry
 * either a plain `2026-08-22` date or a full timestamp, and a list that renders the
 * first as-is and the second through `Intl` is how a column of dates starts looking
 * inconsistent.
 */
export function formatDay(value?: string): string {
  if (!value) return "日期未填写"
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp))
}

/** The same day without the year, for rows where the year is noise. */
export function formatShortDay(value?: string): string {
  if (!value) return ""
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(timestamp))
}