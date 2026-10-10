/**
 * Hand the reader a file rather than a tab full of text.
 *
 * The object URL is revoked right after the click: the browser has taken the
 * bytes by then, and holding it would keep the whole export in memory for the
 * life of the page.
 */
export function saveTextFile(text: string, filename: string, mimeType = "text/plain;charset=utf-8"): void {
  saveBlobFile(new Blob([text], { type: mimeType }), filename)
}

/**
 * The same handover for bytes that are already a file (a backup, an export the
 * server assembled). The URL is revoked right after the click for the reason
 * above: the browser has the bytes by then, and holding it would keep the whole
 * file in memory for the life of the page.
 */
export function saveBlobFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}