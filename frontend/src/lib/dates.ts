/**
 * One date, one reading of it.
 *
 * The article library had grown its own copy of the day formatter and the settings
 * panel its own of the timestamp one; the practice log was about to make a third. The
 * awkward input is the one that matters: rows carry either a plain `2026-08-22` date or
 * a full timestamp, and a list that renders the first as-is and the second through
 * `Intl` is how a column of dates starts looking inconsistent.
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

/**
 * A date *and* a time, for the places where the moment matters (a backup file, an
 * import run). Lists of things you read want `formatDay`; a timestamp that needs to
 * distinguish two writes on the same day wants this.
 *
 * Empty input reads as empty rather than as a placeholder sentence: the caller knows
 * what "nothing" means in its own context ("尚无备份").
 */
export function formatStamp(value?: string): string {
  if (!value) return ""
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleString("zh-CN")
}

/** The same day without the year, for rows where the year is noise. */
export function formatShortDay(value?: string): string {
  if (!value) return ""
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(timestamp))
}