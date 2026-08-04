import { apiRequest } from "./client"
import type { ChatMessage, CompareOutput, KnowledgeItem } from "./types"

export interface ChatSendResult {
  session_id: string
  message_id: string
  status: string
}

export interface ChatConversation {
  session_id: string
  subject?: string
  message_count: number
  last_at: string
  title: string
  preview?: string
}

export interface ChatAttachmentResult {
  id: string
  name: string
  size_bytes: number
  kind: string
}

export function sendChatMessage(
  subject: string,
  message: string,
  sessionId?: string,
  attachmentIds?: string[],
): Promise<ChatSendResult> {
  const payload: Record<string, string | string[]> = { subject, message }
  if (sessionId) payload.session_id = sessionId
  if (attachmentIds && attachmentIds.length > 0) payload.attachment_ids = attachmentIds
  return apiRequest<ChatSendResult>("/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function listChatMessages(subject: string, sessionId?: string, limit = 50): Promise<{ items: ChatMessage[]; count: number }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (subject) params.set("subject", subject)
  if (sessionId) params.set("session_id", sessionId)
  return apiRequest<{ items: ChatMessage[]; count: number }>(`/chat/messages?${params.toString()}`)
}

export function listChatConversations(subject: string, limit = 50): Promise<{ items: ChatConversation[]; count: number }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (subject) params.set("subject", subject)
  return apiRequest<{ items: ChatConversation[]; count: number }>(`/chat/conversations?${params.toString()}`)
}

export function uploadChatAttachment(file: File): Promise<ChatAttachmentResult> {
  const form = new FormData()
  form.append("file", file)
  return apiRequest<ChatAttachmentResult>("/chat/attachments", {
    method: "POST",
    body: form,
  })
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
