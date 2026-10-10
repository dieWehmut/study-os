/**
 * Hand the reader a file rather than a tab full of text.
 *
 * The object URL is revoked right after the click: the browser has taken the
 * bytes by then, and holding it would keep the whole export in memory for the
 * life of the page.
 */
export function saveTextFile(text: string, filename: string, mimeType = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}