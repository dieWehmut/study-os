import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { sectionHash, sectionIDFromHash } from "./article-sections"

const headerOffset = 72

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

  useEffect(() => {
    activeIDRef.current = activeID
  }, [activeID])

  useEffect(() => {
    validIDs.current = new Set(sectionIDs)
    if (!validIDs.current.has(activeID)) setActiveID(sectionIDs[0] ?? "")
  }, [activeID, sectionIDs])

  useEffect(() => {
    if (sectionIDs.length === 0 || location.hash) return
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
    if (scrollingTo.current === id) {
      scrollingTo.current = ""
      return
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "auto", block: "start" })
  }, [location.hash, sectionIDs])

  useEffect(() => {
    const syncRoute = (id: string) => {
      if (scrollingTo.current) return
      if (!id || id === activeIDRef.current) return
      activeIDRef.current = id
      setActiveID(id)
      navigate({ pathname: location.pathname, search: location.search, hash: sectionHash(id) }, {
        replace: true,
        preventScrollReset: true,
      })
    }

    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver((entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)
        const id = (visible[0]?.target as HTMLElement | undefined)?.id
        if (id && validIDs.current.has(id)) syncRoute(id)
      }, {
        rootMargin: `-${headerOffset}px 0px -55% 0px`,
        threshold: [0, 0.25, 0.5, 1],
      })
      for (const id of sectionIDs) {
        const element = document.getElementById(id)
        if (element) observer.observe(element)
      }
      return () => observer.disconnect()
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
      window.removeEventListener("scroll", onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [location.pathname, location.search, navigate, sectionIDs])

  const goToSection = useCallback((id: string) => {
    if (!validIDs.current.has(id)) return
    scrollingTo.current = sectionIDFromHash(location.hash) === id ? "" : id
    setActiveID(id)
    navigate({ pathname: location.pathname, search: location.search, hash: sectionHash(id) }, {
      preventScrollReset: true,
    })
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [location.hash, location.pathname, location.search, navigate])

  return { activeID, goToSection }
}
