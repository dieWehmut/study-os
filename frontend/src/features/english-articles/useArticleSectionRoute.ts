import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { sectionHash, sectionIDFromHash } from "./article-sections"

// Matches `scroll-mt-24` on a section: it is where a section's top lands after
// being scrolled to, so it is exactly the line that says "the reader is here".
// At 72 a section that had just been scrolled to sat *below* the line and counted
// as not yet reached -- the outline then named the section above it.
const headerOffset = 96

function sectionAtScroll(ids: readonly string[]): string {
  let active = ids[0] ?? ""
  for (const id of ids) {
    const element = document.getElementById(id)
    if (!element) continue
    if (element.getBoundingClientRect().top <= headerOffset) active = id
    else break
  }
  return active
}

export interface ArticleSectionRoute {
  activeID: string
  goToSection: (id: string) => void
}

export function useArticleSectionRoute(sectionIDs: readonly string[]): ArticleSectionRoute {
  const location = useLocation()
  const navigate = useNavigate()
  const validIDs = useRef(new Set(sectionIDs))
  const initial = sectionIDFromHash(location.hash)
  const [activeID, setActiveID] = useState(() =>
    sectionIDs.includes(initial) ? initial : sectionIDs[0] ?? "",
  )
  const activeIDRef = useRef(activeID)
  const scrollingTo = useRef("")
  // Set the moment a reader picks a section.
  //
  // The 首段 jump below is scheduled from a render whose address had no section,
  // and its effect can land after the click that chose one -- observed as a click
  // on 第二节 arriving at #section-1-opening. A choice a reader made is never
  // undone by an automatic one.
  const chosenByReader = useRef(false)
  // How long a chosen section keeps the route to itself. Measured in Chromium:
  // without it, clicking 第四节 scrolled there and then the observer reported the
  // sections the smooth scroll passed through, dragging the address -- and the
  // page -- back to 第一节. Long enough for the scroll, short enough that a scroll
  // which never arrives cannot freeze the outline.
  const scrollDeadline = useRef(0)
  // The pending "the scroll has stopped" timer, shared with goToSection so a new
  // click cancels the previous one's settle.
  const settleTimer = useRef(0)

  useEffect(() => {
    activeIDRef.current = activeID
  }, [activeID])

  useEffect(() => {
    validIDs.current = new Set(sectionIDs)
    if (!validIDs.current.has(activeID)) setActiveID(sectionIDs[0] ?? "")
  }, [activeID, sectionIDs])

  useEffect(() => {
    if (sectionIDs.length === 0 || location.hash || chosenByReader.current) return
    const id = sectionIDs[0]
    document.getElementById(id)?.scrollIntoView({ behavior: "auto", block: "start" })
    navigate({ pathname: location.pathname, search: location.search, hash: sectionHash(id) }, {
      replace: true,
      preventScrollReset: true,
    })
  }, [location.hash, location.pathname, location.search, navigate, sectionIDs])

  useEffect(() => {
    const id = sectionIDFromHash(location.hash)
    if (!validIDs.current.has(id)) return
    setActiveID(id)
    // The handler already scrolled, and the flag stays up until the scroll gets
    // there: clearing it here -- which is what this did -- handed the route back
    // to the observer while the page was still travelling.
    if (scrollingTo.current === id) return
    document.getElementById(id)?.scrollIntoView({ behavior: "auto", block: "start" })
  }, [location.hash, sectionIDs])

  useEffect(() => {
    const syncRoute = (id: string) => {
      if (scrollingTo.current) {
        // On the way to the section the reader picked. Passing over other sections
        // is not the reader changing their mind, and *seeing* the target is not
        // arrival either: measured in Chromium, releasing the hold on the first
        // sighting let the observer name the section the scroll was passing and
        // pull the page back. The settle listener below is what ends it.
        if (Date.now() >= scrollDeadline.current) scrollingTo.current = ""
        return
      }
      if (!id || id === activeIDRef.current) return
      activeIDRef.current = id
      setActiveID(id)
      navigate({ pathname: location.pathname, search: location.search, hash: sectionHash(id) }, {
        replace: true,
        preventScrollReset: true,
      })
    }

    // The hold ends when the page stops moving, not when a section is seen: the
    // smooth scroll reports intersections all the way, and the reader's own
    // scrolling afterwards is what should move the outline on.
    const releaseWhenSettled = () => {
      if (!scrollingTo.current) return
      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => {
        if (!scrollingTo.current) return
        scrollingTo.current = ""
        // Now that the page has stopped, the one rule decides where it landed.
        const landed = sectionAtScroll(sectionIDs)
        if (landed) syncRoute(landed)
      }, 180)
    }
    window.addEventListener("scroll", releaseWhenSettled, { passive: true })
    const stopListening = () => {
      window.clearTimeout(settleTimer.current)
      window.removeEventListener("scroll", releaseWhenSettled)
    }

    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length === 0) return
        // The current section is the last one whose top has reached the line, not
        // the first one still touching the band: the section above is usually
        // still intersecting, and naming it moved the outline back one section.
        const top = (entry: IntersectionObserverEntry) => entry.boundingClientRect?.top ?? Number.NEGATIVE_INFINITY
        const passed = visible.filter((entry) => top(entry) <= headerOffset)
        const chosen = passed.length > 0
          ? passed.reduce((last, entry) => (top(entry) > top(last) ? entry : last))
          : visible.reduce((first, entry) => (top(entry) < top(first) ? entry : first))
        const id = (chosen.target as HTMLElement | undefined)?.id
        if (id && validIDs.current.has(id)) syncRoute(id)
      }, {
        rootMargin: `-${headerOffset}px 0px -55% 0px`,
        threshold: [0, 0.25, 0.5, 1],
      })
      for (const id of sectionIDs) {
        const element = document.getElementById(id)
        if (element) observer.observe(element)
      }
      return () => {
        stopListening()
        observer.disconnect()
      }
    }

    let frame = 0
    const syncScrollRoute = () => {
      frame = 0
      syncRoute(sectionAtScroll(sectionIDs))
    }
    const onScroll = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(syncScrollRoute)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      stopListening()
      window.removeEventListener("scroll", onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [location.pathname, location.search, navigate, sectionIDs])

  const goToSection = useCallback((id: string) => {
    // Checked against the sections of this render, not against the set an effect
    // copied: a click can arrive before that effect has run, and a click dropped
    // here is a click the reader cannot tell was dropped. Observed under load as
    // a directory click that left the address at 第一节 -- about one full-suite
    // run in ten.
    if (!sectionIDs.includes(id)) return
    chosenByReader.current = true
    scrollingTo.current = sectionIDFromHash(location.hash) === id ? "" : id
    scrollDeadline.current = Date.now() + 1500
    // A settle left over from the last scroll must not release this one's hold.
    window.clearTimeout(settleTimer.current)
    setActiveID(id)
    navigate({ pathname: location.pathname, search: location.search, hash: sectionHash(id) }, {
      preventScrollReset: true,
    })
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [location.hash, location.pathname, location.search, navigate, sectionIDs])

  return { activeID, goToSection }
}
