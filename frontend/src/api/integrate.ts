import { apiRequest } from "./client"

export interface MindNode {
  id: string
  label: string
  parent_id?: string
  node_type?: string
  /**
   * The prose written under this node in the source wiki.
   *
   * 0807:15 「每个节点可以是笔记、图片」. The label is the skeleton and stays
   * short; this is what the skeleton was abstracted from, kept so that opening
   * a node can answer "what did it actually say" without leaving the map.
   *
   * Optional rather than "": a node with nothing written under it is not a node
   * carrying an empty note, and the drawing has to be able to tell them apart
   * to know whether to mark it as openable.
   */
  note?: string
  /**
   * The picture written under this node, as the other half of 0807:15's
   * 「每个节点可以是笔记、图片」.
   *
   * A source path, not an upload: the map is derived from markdown every time
   * it is drawn and never stored, so there is nowhere for a node to keep an
   * image of its own. Whatever `![](...)` the wiki carries is the image, which
   * also means the picture survives a re-parse exactly like the shape does.
   */
  image?: string
  /** The `![alt]` text, for readers who cannot see the image. */
  image_alt?: string
}

export interface MindMap {
  title: string
  nodes: MindNode[]
}

export interface IntegrateCard {
  id: string
  card_type: string
  title: string
  body: string
  tags?: string[]
}

export interface IntegratedNote {
  id: string
  subject?: string
  title: string
  source_type?: string
  source_id?: string
  mindmap: MindMap
  cards: IntegrateCard[]
  created_at: string
}

export interface IntegrateInput {
  subject: string
  title?: string
  text?: string
  knowledge_id?: string
  max_cards?: number
}

export function createIntegrate(input: IntegrateInput): Promise<IntegratedNote> {
  return apiRequest<IntegratedNote>("/integrate", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function listIntegrateNotes(subject: string, limit = 20): Promise<{ items: IntegratedNote[]; count: number }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (subject) params.set("subject", subject)
  return apiRequest<{ items: IntegratedNote[]; count: number }>(`/integrate?${params.toString()}`)
}

export function getIntegrateNote(id: string): Promise<IntegratedNote> {
  return apiRequest<IntegratedNote>(`/integrate/${encodeURIComponent(id)}`)
}
