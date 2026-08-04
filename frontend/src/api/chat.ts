import { apiRequest } from "./client"
import type { ChatMessage, CompareOutput, KnowledgeItem } from "./types"

export interface ChatSendResult {
  message_id: string
  status: string
}

export function sendChatMessage(subject: string, message: string): Promise<ChatSendResult> {
  return apiRequest<ChatSendResult>("/chat", {
    method: "POST",
    body: JSON.stringify({ subject, message }),
  })
}

export function listChatMessages(subject: string, limit = 50): Promise<{ items: ChatMessage[]; count: number }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (subject) params.set("subject", subject)
  return apiRequest<{ items: ChatMessage[]; count: number }>(`/chat/messages?${params.toString()}`)
}

export function compareKnowledge(subject: string, termA: string, termB: string): Promise<CompareOutput> {
  return apiRequest<CompareOutput>("/compare", {
    method: "POST",
    body: JSON.stringify({ subject, term_a: termA, term_b: termB }),
  })
}

export function dumpThought(text: string): Promise<{ id: string; term: string }> {
  return apiRequest<{ id: string; term: string }>("/dump", {
    method: "POST",
    body: JSON.stringify({ text }),
  })
}

export function updateKnowledgeTag(id: string, tag: string, remove: boolean): Promise<KnowledgeItem> {
  return apiRequest<KnowledgeItem>(`/knowledge/${encodeURIComponent(id)}/tag`, {
    method: "POST",
    body: JSON.stringify({ tag, remove }),
  })
}
