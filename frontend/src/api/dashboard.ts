import { apiRequest } from "./client"
import type { DashboardData } from "./types"

export function getDashboard(): Promise<DashboardData> {
  return apiRequest<DashboardData>("/dashboard")
}

export function seedDemo(): Promise<{ status: string; knowledge_id: string; prompt_count: number }> {
  return apiRequest("/demo/seed", { method: "POST" })
}
