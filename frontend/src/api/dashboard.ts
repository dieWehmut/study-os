import { apiRequest } from "./client"
import type { DashboardData } from "./types"

export function getDashboard(subject?: string): Promise<DashboardData> {
  const params = new URLSearchParams()
  if (subject) params.set("subject", subject)
  const query = params.toString()
  return apiRequest<DashboardData>(query ? `/dashboard?${query}` : "/dashboard")
}

export function seedDemo(): Promise<{ status: string; knowledge_id: string; prompt_count: number }> {
  return apiRequest("/demo/seed", { method: "POST" })
}
