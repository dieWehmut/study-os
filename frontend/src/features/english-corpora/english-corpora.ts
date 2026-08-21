import { publicBasePath, type RuntimeEnv } from "@/lib/runtime"

export interface EnglishCorpusDefinition {
  id: "word-wiki" | "multiword-expressions"
  title: string
  description: string
  assetPath: string
  total: number
}

export interface EnglishCorpusEntry {
  id: string
  label: string
  target: string
  kind: string
}

export const ENGLISH_CORPORA: EnglishCorpusDefinition[] = [
  {
    id: "word-wiki",
    title: "Word Wiki",
    description: "3913 个英语单词索引，按字母浏览和搜索。",
    assetPath: "content/english/word-wiki-moc.md",
    total: 3913,
  },
  {
    id: "multiword-expressions",
    title: "多词表达与语法家族",
    description: "1593 篇词汇表达与 10 篇语法家族索引。",
    assetPath: "content/english/multiword-expression-moc.md",
    total: 1603,
  },
]

const helperTargets = new Set(["01-全量总表", "99-待补表达"])

export function englishCorpusAssetURL(
  corpus: EnglishCorpusDefinition,
  env?: RuntimeEnv,
): string {
  return `${publicBasePath(env)}${corpus.assetPath}`
}

export function parseEnglishCorpus(
  markdown: string,
  corpus: EnglishCorpusDefinition,
): EnglishCorpusEntry[] {
  const entries: EnglishCorpusEntry[] = []
  const seen = new Set<string>()
  const links = markdown.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\](?:\s*`([^`]+)`)?/g)

  for (const match of links) {
    const target = match[1].trim()
    const alias = match[2]?.trim()
    const explicitKind = match[3]?.trim()
    if (corpus.id === "word-wiki" && !target.startsWith("word-wiki/")) continue
    if (corpus.id === "multiword-expressions" && helperTargets.has(target)) continue
    if (seen.has(target)) continue
    seen.add(target)

    const fallbackLabel = target.startsWith("word-wiki/")
      ? target.slice("word-wiki/".length)
      : target
    entries.push({
      id: `${corpus.id}:${target}`,
      label: alias || fallbackLabel,
      target,
      kind: explicitKind || (corpus.id === "word-wiki" ? "word" : "grammar-family"),
    })
  }

  return entries
}

export async function loadEnglishCorpus(
  corpus: EnglishCorpusDefinition,
  signal?: AbortSignal,
): Promise<{ markdown: string; entries: EnglishCorpusEntry[] }> {
  const response = await fetch(englishCorpusAssetURL(corpus), { signal })
  if (!response.ok) throw new Error(`无法读取 ${corpus.title}`)
  const markdown = await response.text()
  return { markdown, entries: parseEnglishCorpus(markdown, corpus) }
}
