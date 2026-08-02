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
  normalizeDailyLimit,
  readPersistedSettings,
  writePersistedSettings,
  type PersistedSettings,
} from "@/lib/settings"

interface SettingsStore {
  settings: PersistedSettings
  status: SystemStatus | null
  backups: BackupRecord[]
  isLoading: boolean
  isSaving: boolean
  isBackingUp: boolean
  error: string | null
  notice: string | null
  load: () => Promise<void>
  saveDailyLimit: (value: number) => Promise<void>
  createDailyBackup: () => Promise<void>
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: readPersistedSettings(),
  status: null,
  backups: [],
  isLoading: false,
  isSaving: false,
  isBackingUp: false,
  error: null,
  notice: null,

  async load() {
    set({ isLoading: true, error: null, notice: null })
    try {
      const [status, backupResponse] = await Promise.all([getSystemStatus(), listBackups(10)])
      const dailyLimit = normalizeDailyLimit(status.review.daily_limit)
      const settings = { dailyLimit }
      writePersistedSettings(settings)
      set({ status: { ...status, review: { ...status.review, daily_limit: dailyLimit } }, backups: backupResponse.items, settings, isLoading: false })
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
}))
