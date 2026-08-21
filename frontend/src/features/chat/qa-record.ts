import type { QARecordContextType } from "@/api/chat"

const qaContextTypes: readonly QARecordContextType[] = ["knowledge_item", "question", "lesson"]

export function qaContextValue(type: QARecordContextType, id: string): string {
  return JSON.stringify([type, id])
}

export function parseQAContextValue(value: string): [QARecordContextType, string] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [type, id] = parsed
    if (typeof type !== "string" || !qaContextTypes.includes(type as QARecordContextType)) return null
    if (typeof id !== "string" || !id.trim()) return null
    return [type as QARecordContextType, id.trim()]
  } catch {
    return null
  }
}
