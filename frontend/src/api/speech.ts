import { apiRequest, resolveApiBase } from "./client"

// 一个预设服务商：只提供默认值，真正跑合成时仍以用户填写的字段为准。
export interface SpeechProviderSpec {
  id: string
  display_name: string
  base_url?: string
  model?: string
  voice?: string
  auth_style?: string
  local?: boolean
  voice_hint?: string
  endpoint_hint?: string
}

// 全局语音合成状态。密钥值永不回传，只回传"是否已配置"。
export interface SpeechStatus {
  provider: string
  base_url?: string
  model?: string
  voice?: string
  format?: string
  key_configured: boolean
  configured: boolean
  providers: SpeechProviderSpec[]
}

// 一个语音角色：可覆盖全局的接口地址／模型／发音人。
export interface VoiceRole {
  id: string
  name: string
  bio?: string
  has_avatar: boolean
  provider?: string
  base_url?: string
  model?: string
  voice?: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface SpeechSettingsResponse {
  speech: SpeechStatus
  roles: VoiceRole[]
  active_role_id: string
}

// 每个字段都是可选的：省略表示不改，传空字符串表示清空。
export interface SpeechConfigInput {
  provider?: string
  base_url?: string
  api_key?: string
  model?: string
  voice?: string
  format?: string
}

export interface VoiceRoleInput {
  name: string
  bio: string
  provider: string
  base_url: string
  model: string
  voice: string
  sort_order: number
}

// 更新走指针语义：只把用户真正改过的字段放进来。
export interface VoiceRolePatch {
  name?: string
  bio?: string
  provider?: string
  base_url?: string
  model?: string
  voice?: string
  sort_order?: number
}

export interface VoiceRoleListResponse {
  items: VoiceRole[]
  count: number
  active_role_id: string
}

export interface VoiceRoleAvatarResult {
  id: string
  has_avatar: boolean
  size_bytes: number
}

export function getSpeechSettings(): Promise<SpeechSettingsResponse> {
  return apiRequest<SpeechSettingsResponse>("/speech")
}

// 保存全局接口配置。API Key 写入本地 env 文件，响应里永远不会回显它的值。
export function saveSpeechConfig(input: SpeechConfigInput): Promise<{ speech: SpeechStatus }> {
  return apiRequest<{ speech: SpeechStatus }>("/speech/config", {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export function listVoiceRoles(): Promise<VoiceRoleListResponse> {
  return apiRequest<VoiceRoleListResponse>("/speech/roles")
}

export function createVoiceRole(input: VoiceRoleInput): Promise<VoiceRole> {
  return apiRequest<VoiceRole>("/speech/roles", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function updateVoiceRole(id: string, patch: VoiceRolePatch): Promise<VoiceRole> {
  return apiRequest<VoiceRole>(`/speech/roles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export function deleteVoiceRole(id: string): Promise<void> {
  return apiRequest<void>(`/speech/roles/${encodeURIComponent(id)}`, { method: "DELETE" })
}

// 传空字符串表示取消选择，回到全局默认发音。
export function setActiveVoiceRole(roleID: string): Promise<{ active_role_id: string }> {
  return apiRequest<{ active_role_id: string }>("/speech/roles/active", {
    method: "PATCH",
    body: JSON.stringify({ role_id: roleID }),
  })
}

// apiRequest 遇到 FormData 会自动跳过 Content-Type，交给浏览器补 boundary。
export function uploadVoiceRoleAvatar(id: string, file: File): Promise<VoiceRoleAvatarResult> {
  const body = new FormData()
  body.append("file", file)
  return apiRequest<VoiceRoleAvatarResult>(`/speech/roles/${encodeURIComponent(id)}/avatar`, {
    method: "POST",
    body,
  })
}

// 头像要的是一个能直接喂给 <img src> 的绝对地址，所以走 resolveApiBase 而不是
// apiRequest。version 是缓存击穿参数：重传后同名文件会被浏览器认成旧图。
export function voiceRoleAvatarURL(id: string, version?: string | number): string {
  const url = `${resolveApiBase()}/speech/roles/${encodeURIComponent(id)}/avatar`
  return version === undefined ? url : `${url}?v=${encodeURIComponent(String(version))}`
}
