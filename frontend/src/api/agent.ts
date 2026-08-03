import { apiRequest } from "./client"

export interface VendorInfo {
  id: string
  display_name: string
  implemented: boolean
  key_configured?: boolean
  base_url?: string
  models?: string[]
  active: boolean
}

export interface VendorListResponse {
  active_provider: string
  items: VendorInfo[]
}

export interface ProviderTestResult {
  ok: boolean
  provider?: string
  latency_ms?: number
  error?: string
}

export function getVendors(): Promise<VendorListResponse> {
  return apiRequest<VendorListResponse>("/agent/vendors")
}

export function setActiveProvider(provider: string): Promise<{ active_provider: string }> {
  return apiRequest<{ active_provider: string }>("/agent/active", {
    method: "PATCH",
    body: JSON.stringify({ provider }),
  })
}

export function testProvider(provider: string): Promise<ProviderTestResult> {
  return apiRequest<ProviderTestResult>("/agent/test", {
    method: "POST",
    body: JSON.stringify({ provider }),
  })
}
