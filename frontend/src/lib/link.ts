import { routerMode } from "./runtime"

/**
 * A full URL for one route of this app, for a link the reader will keep or hand on.
 *
 * Built from the route rather than from `window.location`: the address bar and the
 * route are two different things here. The desktop shell has no address bar at all,
 * and the Pages build keeps the route inside the hash -- a link composed from
 * `window.location.pathname` alone lands on the site root with the target missing.
 *
 * `pathname` and `search` are what the router reports (`useLocation()`), not
 * `location.href`.
 */
export function appUrl(pathname: string, search = ""): string {
  const path = `${pathname}${search}`
  if (routerMode() === "hash") {
    return `${window.location.origin}${window.location.pathname}#${path}`
  }
  return `${window.location.origin}${path}`
}

/**
 * The same URL with an anchor on the end, for a section inside a page.
 *
 * A hash route already ends in its own fragment, so the anchor is appended after
 * it rather than replacing it: `#/reading/a#section-2` is one route with an anchor.
 */
export function appUrlWithHash(pathname: string, search: string, anchor: string): string {
  return `${appUrl(pathname, search)}${anchor}`
}

/** Copy a URL, answering whether the browser let it happen. */
export async function copyUrl(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}