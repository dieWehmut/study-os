/**
 * Hand the reader a file rather than a tab full of text.
 *
 * The anchor goes into the document before it is clicked. A detached one works in
 * Chrome but is not required to: the download attribute is only acted on for a
 * link that is part of the page, so the three exports and the backup download
 * would silently do nothing in a browser that reads it strictly. It is removed
 * again on the way out -- an invisible anchor left behind per export is litter.
 *
 * The object URL is revoked right after the click: the browser has taken the
 * bytes by then, and holding it would keep the whole export in memory for the
 * life of the page.
 */
export function saveTextFile(text: string, filename: string, mimeType = "text/plain;charset=utf-8"): void {
  saveBlobFile(new Blob([text], { type: mimeType }), filename)
}

/** The same handover for bytes that are already a file (a backup, a server export). */
export function saveBlobFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}