import { apiRequest } from "./client"

export interface EnglishArticleSegment {
  text: string
  emphasized?: boolean
}

export interface EnglishArticleParagraph {
  segments: EnglishArticleSegment[]
  translation: string
}

export interface EnglishArticleVocabulary {
  term: string
  british_phonetic?: string
  american_phonetic?: string
  part_of_speech?: string
  definition: string
  usage?: string
  examples?: string[]
}

export interface EnglishArticleSection {
  title: string
  paragraphs: EnglishArticleParagraph[]
  vocabulary?: EnglishArticleVocabulary[]
}

export interface EnglishArticleMetadata {
  original_title?: string
  author?: string
  source_name?: string
  source_url?: string
  published_at?: string
}

export interface EnglishArticleContent {
  title: string
  metadata: EnglishArticleMetadata
  sections: EnglishArticleSection[]
}

export interface EnglishArticle {
  id?: string
  title: string
  original_title?: string
  author?: string
  source_name?: string
  source_url?: string
  published_at?: string
  original_text?: string
  content?: EnglishArticleContent
  markdown?: string
  provider?: string
  model?: string
  section_count?: number
  created_at?: string
  updated_at?: string
}

export interface EnglishArticleInput {
  original_text: string
  title?: string
  original_title?: string
  author?: string
  source_name?: string
  source_url?: string
  published_at?: string
}

export interface EnglishArticleListOptions {
  limit?: number
}

export interface EnglishArticleListResponse {
  items: EnglishArticle[]
  count: number
}

type EnglishArticleWire = Omit<EnglishArticle, "content"> & {
  content?: EnglishArticleContentWire | string
  content_json?: EnglishArticleContentWire | string
}

type EnglishArticleContentWire = Omit<EnglishArticleContent, "metadata" | "sections"> &
  Partial<EnglishArticleMetadata> & {
    metadata?: EnglishArticleMetadata
    sections: Array<Omit<EnglishArticleSection, "paragraphs"> & {
      paragraphs: Array<Omit<EnglishArticleParagraph, "segments"> & {
        segments?: EnglishArticleSegment[]
        english_segments?: EnglishArticleSegment[]
      }>
    }>
  }

function normalizeContent(value: EnglishArticleContentWire): EnglishArticleContent {
  return {
    title: value.title,
    metadata: value.metadata ?? {
      original_title: value.original_title,
      author: value.author,
      source_name: value.source_name,
      source_url: value.source_url,
      published_at: value.published_at,
    },
    sections: (value.sections ?? []).map((section) => ({
      ...section,
      paragraphs: (section.paragraphs ?? []).map(({ english_segments: legacySegments, ...paragraph }) => ({
        ...paragraph,
        segments: paragraph.segments ?? legacySegments ?? [],
      })),
    })),
  }
}

function parseContent(value: EnglishArticleWire["content"]): EnglishArticleContent | undefined {
  if (!value) return undefined
  if (typeof value !== "string") return normalizeContent(value)
  try {
    return normalizeContent(JSON.parse(value) as EnglishArticleContentWire)
  } catch {
    return undefined
  }
}

export function normalizeEnglishArticle(value: EnglishArticleWire): EnglishArticle {
  const { content_json: legacyContent, ...article } = value
  const content = parseContent(article.content) ?? parseContent(legacyContent)
  const metadata = content?.metadata
  return {
    ...article,
    title: article.title || content?.title || "未命名文章",
    original_title: article.original_title || metadata?.original_title,
    author: article.author || metadata?.author,
    source_name: article.source_name || metadata?.source_name,
    source_url: article.source_url || metadata?.source_url,
    published_at: article.published_at || metadata?.published_at,
    section_count: article.section_count ?? content?.sections.length,
    content,
  }
}

export async function listEnglishArticles(
  options: EnglishArticleListOptions = {},
): Promise<EnglishArticleListResponse> {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const response = await apiRequest<{ items?: EnglishArticleWire[]; count?: number }>(
    `/english/articles${params.size > 0 ? `?${params.toString()}` : ""}`,
  )
  const items = (response.items ?? []).map(normalizeEnglishArticle)
  return { items, count: response.count ?? items.length }
}

export async function generateEnglishArticle(input: EnglishArticleInput): Promise<EnglishArticle> {
  const article = await apiRequest<EnglishArticleWire>("/english/articles/generate", {
    method: "POST",
    body: JSON.stringify(input),
  })
  return normalizeEnglishArticle(article)
}

export async function createEnglishArticle(
  input: EnglishArticleInput | EnglishArticle,
): Promise<EnglishArticle> {
  const payload: Record<string, unknown> = {
    original_text: input.original_text,
    title: input.title,
    original_title: input.original_title,
    author: input.author,
    source_name: input.source_name,
    source_url: input.source_url,
    published_at: input.published_at,
  }
  if ("id" in input && input.id) payload.id = input.id
  if (!("content" in input) || !input.content) {
    throw new Error("English article content is required")
  }
  payload.content = input.content
  if ("provider" in input && input.provider) payload.provider = input.provider
  if ("model" in input && input.model) payload.model = input.model
  const article = await apiRequest<EnglishArticleWire>("/english/articles", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return normalizeEnglishArticle(article)
}

export async function getEnglishArticle(id: string): Promise<EnglishArticle> {
  return normalizeEnglishArticle(
    await apiRequest<EnglishArticleWire>(`/english/articles/${encodeURIComponent(id)}`),
  )
}

export async function regenerateEnglishArticle(id: string): Promise<EnglishArticle> {
  return normalizeEnglishArticle(
    await apiRequest<EnglishArticleWire>(`/english/articles/${encodeURIComponent(id)}/regenerate`, {
      method: "POST",
    }),
  )
}

export function deleteEnglishArticle(id: string): Promise<void> {
  return apiRequest<void>(`/english/articles/${encodeURIComponent(id)}`, { method: "DELETE" })
}
