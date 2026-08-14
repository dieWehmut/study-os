function headingSlug(title: string): string {
  return title
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
}
export function articleSectionID(title: string, index: number): string {
  const prefix = `section-${index + 1}`
  const slug = headingSlug(title)
  return slug ? `${prefix}-${slug}` : prefix
}

export function articleSectionIDs(titles: readonly string[]): string[] {
  return titles.map(articleSectionID)
}

export function sectionHash(id: string): string {
  return `#${encodeURIComponent(id)}`
}

export function sectionIDFromHash(hash: string): string {
  if (!hash.startsWith("#")) return ""
  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return ""
  }
}
