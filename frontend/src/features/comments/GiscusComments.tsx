import Giscus from "@giscus/react"
import { useLocation } from "react-router-dom"
import { useEffect, useState } from "react"

import { isStaticDemo } from "@/lib/runtime"
import { giscusConfig, giscusTerm, type GiscusEnv } from "./giscus-config"

type GiscusTheme = "light" | "dark"

function rootTheme(): GiscusTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export function GiscusComments() {
  const location = useLocation()
  const [theme, setTheme] = useState<GiscusTheme>(() => rootTheme())

  useEffect(() => {
    const root = document.documentElement
    const updateTheme = () => setTheme(rootTheme())

    updateTheme()
    if (typeof MutationObserver === "undefined") return

    const observer = new MutationObserver(updateTheme)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  if (!isStaticDemo()) return null

  const config = giscusConfig(import.meta.env as GiscusEnv)
  if (!config) return null

  const term = giscusTerm(location.pathname)

  return (
    <section
      aria-label="讨论"
      className="mt-10 border-t border-border/60 pt-6"
    >
      <Giscus
        key={term}
        repo={config.repo as `${string}/${string}`}
        repoId={config.repoId}
        category={config.category}
        categoryId={config.categoryId}
        mapping="specific"
        term={term}
        strict="1"
        reactionsEnabled="1"
        emitMetadata="0"
        inputPosition="bottom"
        theme={theme}
        lang="zh-CN"
        loading="lazy"
      />
    </section>
  )
}
