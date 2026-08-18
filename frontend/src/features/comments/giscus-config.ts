export interface GiscusEnv {
  VITE_GISCUS_REPO?: string
  VITE_GISCUS_REPO_ID?: string
  VITE_GISCUS_CATEGORY?: string
  VITE_GISCUS_CATEGORY_ID?: string
}

export interface GiscusConfig {
  repo: string
  repoId: string
  category: string
  categoryId: string
}

const clean = (value: string | undefined) => value?.trim() ?? ""

export function giscusConfig(env: GiscusEnv): GiscusConfig | null {
  const repo = clean(env.VITE_GISCUS_REPO)
  const repoId = clean(env.VITE_GISCUS_REPO_ID)
  const category = clean(env.VITE_GISCUS_CATEGORY)
  const categoryId = clean(env.VITE_GISCUS_CATEGORY_ID)

  if (!repo || !repoId || !category || !categoryId) return null

  return { repo, repoId, category, categoryId }
}

export function giscusTerm(pathname: string): string {
  const normalized = `/${pathname.replace(/^\/+|\/+$/g, "")}`
  return `study-os:${normalized === "/" ? "/" : normalized}`
}
