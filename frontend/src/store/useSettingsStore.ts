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
  load: () => Promise<void>
  saveDailyLimit: (value: number) => Promise<void>
  createDailyBackup: () => Promise<void>
  switchProvider: (provider: string) => Promise<void>
  testProvider: (provider: string) => Promise<void>
  saveConfig: (provider: string, values: VendorConfigInput) => Promise<void>
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
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
}))
