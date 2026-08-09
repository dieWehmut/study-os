import { create } from "zustand"

import {
  createBackup,
  getSystemStatus,
  listBackups,
  type BackupRecord,
  type SystemStatus,
  updateSettings,
} from "@/api/system"
import {
  getVendors,
  saveVendorConfig,
  setActiveProvider,
  testProvider,
  type ProviderTestResult,
  type VendorConfigInput,
  type VendorInfo,
} from "@/api/agent"
import {
  createVoiceRole,
  deleteVoiceRole,
  getSpeechSettings,
  listVoiceRoles,
  saveSpeechConfig,
  setActiveVoiceRole,
  updateVoiceRole,
  uploadVoiceRoleAvatar,
  type SpeechConfigInput,
  type SpeechStatus,
  type VoiceRole,
  type VoiceRoleInput,
  type VoiceRolePatch,
} from "@/api/speech"
import {
  normalizeDailyLimit,
  readPersistedSettings,
  writePersistedSettings,
  type PersistedSettings,
} from "@/lib/settings"

interface SettingsStore {
  settings: PersistedSettings
  status: SystemStatus | null
  backups: BackupRecord[]
  vendors: VendorInfo[]
  activeProvider: string
  isTestingProvider: boolean
  providerTestNotice: string | null
  isSavingConfig: boolean
  isLoading: boolean
  isSaving: boolean
  isBackingUp: boolean
  error: string | null
  notice: string | null
  speech: SpeechStatus | null
  voiceRoles: VoiceRole[]
  activeVoiceRoleId: string
  isSavingSpeech: boolean
  speechError: string | null
  speechNotice: string | null
  load: () => Promise<void>
  saveDailyLimit: (value: number) => Promise<void>
  createDailyBackup: () => Promise<void>
  switchProvider: (provider: string) => Promise<void>
  testProvider: (provider: string) => Promise<void>
  saveConfig: (provider: string, values: VendorConfigInput) => Promise<void>
  loadSpeech: () => Promise<void>
  saveSpeechSettings: (values: SpeechConfigInput) => Promise<void>
  addVoiceRole: (input: VoiceRoleInput) => Promise<void>
  editVoiceRole: (id: string, patch: VoiceRolePatch) => Promise<void>
  removeVoiceRole: (id: string) => Promise<void>
  activateVoiceRole: (id: string) => Promise<void>
  changeVoiceRoleAvatar: (id: string, file: File) => Promise<void>
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

// 角色的增删改都会影响排序与激活状态，所以每次写入后统一从后端重新拉一次列表，
// 而不是在本地拼接一个可能和数据库不一致的数组。
async function refreshVoiceRoles(): Promise<{ voiceRoles: VoiceRole[]; activeVoiceRoleId: string }> {
  const response = await listVoiceRoles()
  return { voiceRoles: response.items ?? [], activeVoiceRoleId: response.active_role_id ?? "" }
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: readPersistedSettings(),
  status: null,
  backups: [],
  vendors: [],
  activeProvider: "mock",
  isTestingProvider: false,
  providerTestNotice: null,
  isSavingConfig: false,
  isLoading: false,
  isSaving: false,
  isBackingUp: false,
  error: null,
  notice: null,
  speech: null,
  voiceRoles: [],
  activeVoiceRoleId: "",
  isSavingSpeech: false,
  speechError: null,
  speechNotice: null,

  async load() {
    set({ isLoading: true, error: null, notice: null })
    try {
      const [status, backupResponse, vendorResponse] = await Promise.all([getSystemStatus(), listBackups(10), getVendors()])
      const dailyLimit = normalizeDailyLimit(status.review.daily_limit)
      const settings = { dailyLimit }
      writePersistedSettings(settings)
      set({
        status: { ...status, review: { ...status.review, daily_limit: dailyLimit } },
        backups: backupResponse.items,
        vendors: vendorResponse.items,
        activeProvider: vendorResponse.active_provider,
        settings,
        isLoading: false,
      })
    } catch (error) {
      set({ isLoading: false, error: `无法读取系统设置：${errorMessage(error, "服务不可用")}` })
    }
  },

  async saveDailyLimit(value) {
    const dailyLimit = normalizeDailyLimit(value)
    set({ isSaving: true, error: null, notice: null })
    try {
      const response = await updateSettings({ daily_limit: dailyLimit })
      const savedLimit = normalizeDailyLimit(response.daily_limit)
      const settings = { dailyLimit: savedLimit }
      writePersistedSettings(settings)
      const status = get().status
      set({ settings, status: status ? { ...status, review: { ...status.review, daily_limit: savedLimit } } : status, isSaving: false, notice: "设置已保存" })
    } catch (error) {
      set({ isSaving: false, error: `设置保存失败：${errorMessage(error, "服务不可用")}` })
    }
  },

  async createDailyBackup() {
    set({ isBackingUp: true, error: null, notice: null })
    try {
      await createBackup("daily")
      const backupResponse = await listBackups(10)
      const status = get().status
      set({ backups: backupResponse.items, status: status ? { ...status, backup: { ...status.backup, count: backupResponse.count } } : status, isBackingUp: false, notice: "备份已创建" })
    } catch (error) {
      set({ isBackingUp: false, error: `备份失败：${errorMessage(error, "服务不可用")}` })
    }
  },

  async switchProvider(provider) {
    set({ error: null, notice: null, providerTestNotice: null })
    try {
      const response = await setActiveProvider(provider)
      const status = get().status
      const vendors = get().vendors.map((vendor) => ({
        ...vendor,
        active: vendor.id === response.active_provider,
      }))
      set({
        vendors,
        activeProvider: response.active_provider,
        status: status ? { ...status, provider: { ...status.provider, name: response.active_provider, configured: true, available: true } } : status,
        notice: "AI 服务商已切换",
      })
    } catch (error) {
      set({ error: `服务商切换失败：${errorMessage(error, "无法写入 .env.local")}` })
    }
  },

  async testProvider(provider) {
    set({ isTestingProvider: true, error: null, providerTestNotice: null })
    try {
      const result: ProviderTestResult = await testProvider(provider)
      if (result.ok) {
        set({ isTestingProvider: false, providerTestNotice: `${result.provider ?? provider} 连通正常（${result.latency_ms ?? 0}ms）` })
      } else {
        set({ isTestingProvider: false, providerTestNotice: `连通失败：${result.error ?? "未知错误"}` })
      }
    } catch (error) {
      set({ isTestingProvider: false, providerTestNotice: `连通失败：${errorMessage(error, "服务不可用")}` })
    }
  },

  async saveConfig(provider, values) {
    set({ isSavingConfig: true, error: null, notice: null, providerTestNotice: null })
    try {
      const result = await saveVendorConfig({ ...values, provider })
      const vendorResponse = await getVendors()
      const status = get().status
      const nextStatus = status
        ? {
            ...status,
            provider: {
              ...status.provider,
              key_configured: result.key_configured,
              configured: true,
              available: true,
              ...(result.model ? { model: result.model } : {}),
            },
          }
        : status
      set({
        isSavingConfig: false,
        vendors: vendorResponse.items,
        activeProvider: vendorResponse.active_provider,
        status: nextStatus,
        notice: "AI 配置已保存",
      })
    } catch (error) {
      set({ isSavingConfig: false, error: `配置保存失败：${errorMessage(error, "无法写入 .env.local")}` })
    }
  },

  // 语音合成独立加载：它坏掉时诊断信息仍要能显示，不该把整个设置页拖成错误态。
  async loadSpeech() {
    set({ speechError: null })
    try {
      const response = await getSpeechSettings()
      set({
        speech: response.speech,
        voiceRoles: response.roles ?? [],
        activeVoiceRoleId: response.active_role_id ?? "",
      })
    } catch (error) {
      set({ speechError: `无法读取语音合成配置：${errorMessage(error, "服务不可用")}` })
    }
  },

  async saveSpeechSettings(values) {
    set({ isSavingSpeech: true, speechError: null, speechNotice: null })
    try {
      const response = await saveSpeechConfig(values)
      set({ speech: response.speech, isSavingSpeech: false, speechNotice: "语音合成配置已保存" })
    } catch (error) {
      set({ isSavingSpeech: false, speechError: `语音合成配置保存失败：${errorMessage(error, "无法写入 .env.local")}` })
    }
  },

  async addVoiceRole(input) {
    set({ isSavingSpeech: true, speechError: null, speechNotice: null })
    try {
      await createVoiceRole(input)
      set({ ...(await refreshVoiceRoles()), isSavingSpeech: false, speechNotice: "语音角色已创建" })
    } catch (error) {
      set({ isSavingSpeech: false, speechError: `角色创建失败：${errorMessage(error, "服务不可用")}` })
    }
  },

  async editVoiceRole(id, patch) {
    set({ isSavingSpeech: true, speechError: null, speechNotice: null })
    try {
      await updateVoiceRole(id, patch)
      set({ ...(await refreshVoiceRoles()), isSavingSpeech: false, speechNotice: "语音角色已保存" })
    } catch (error) {
      set({ isSavingSpeech: false, speechError: `角色保存失败：${errorMessage(error, "服务不可用")}` })
    }
  },

  async removeVoiceRole(id) {
    set({ isSavingSpeech: true, speechError: null, speechNotice: null })
    try {
      await deleteVoiceRole(id)
      set({ ...(await refreshVoiceRoles()), isSavingSpeech: false, speechNotice: "语音角色已删除" })
    } catch (error) {
      set({ isSavingSpeech: false, speechError: `角色删除失败：${errorMessage(error, "服务不可用")}` })
    }
  },

  async activateVoiceRole(id) {
    set({ speechError: null, speechNotice: null })
    try {
      const response = await setActiveVoiceRole(id)
      const activeVoiceRoleId = response.active_role_id ?? ""
      set({ activeVoiceRoleId, speechNotice: activeVoiceRoleId ? "已切换当前语音角色" : "已恢复全局默认发音" })
    } catch (error) {
      set({ speechError: `角色切换失败：${errorMessage(error, "服务不可用")}` })
    }
  },

  async changeVoiceRoleAvatar(id, file) {
    set({ isSavingSpeech: true, speechError: null, speechNotice: null })
    try {
      await uploadVoiceRoleAvatar(id, file)
      set({ ...(await refreshVoiceRoles()), isSavingSpeech: false, speechNotice: "头像已更新" })
    } catch (error) {
      set({ isSavingSpeech: false, speechError: `头像上传失败：${errorMessage(error, "服务不可用")}` })
    }
  },
}))
