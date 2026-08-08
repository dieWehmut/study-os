import { useEffect, useState } from "react"
import { AudioLines, Bot, Database, Download, HardDrive, RefreshCw, Save, ShieldCheck, UploadCloud, Users } from "lucide-react"

import type { VendorConfigInput } from "@/api/agent"
import {
  voiceRoleAvatarURL,
  type SpeechConfigInput,
  type VoiceRole,
  type VoiceRolePatch,
} from "@/api/speech"
import { applyUpdate, getUpdateStatus, type UpdateStatus } from "@/api/update"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { MAX_DAILY_LIMIT, MIN_DAILY_LIMIT, normalizeDailyLimit } from "@/lib/settings"
import { useSettingsStore } from "@/store/useSettingsStore"

function formatDate(value?: string): string {
  if (!value) return "尚无备份"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN")
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function platformLabel(platform: string): string {
  const [os, arch] = platform.split("/")
  const osName = os === "windows" ? "Windows" : os === "darwin" ? "macOS" : os === "linux" ? "Linux" : os
  const archName = arch === "amd64" ? "64 位" : arch === "arm64" ? "ARM64" : arch
  return [osName, archName].filter(Boolean).join(" · ")
}

// 新增角色和编辑角色共用同一套草稿，用这个哨兵值区分"正在新建"。
const newVoiceRoleKey = "new"

// 后端 isSupportedSpeechFormat 允许的容器格式。
const speechFormatOptions = ["wav", "mp3", "ogg", "m4a", "aac", "flac"].map((format) => ({
  value: format,
  label: format.toUpperCase(),
}))

export default function SettingsPanel() {
  const {
    settings,
    status,
    backups,
    vendors,
    isTestingProvider,
    providerTestNotice,
    isSavingConfig,
    isLoading,
    isSaving,
    isBackingUp,
    error,
    notice,
    speech,
    voiceRoles,
    activeVoiceRoleId,
    isSavingSpeech,
    speechError,
    speechNotice,
    load,
    saveDailyLimit,
    createDailyBackup,
    switchProvider,
    testProvider,
    saveConfig,
    loadSpeech,
    saveSpeechSettings,
    addVoiceRole,
    editVoiceRole,
    removeVoiceRole,
    activateVoiceRole,
    changeVoiceRoleAvatar,
  } = useSettingsStore()
  const [dailyLimitDraft, setDailyLimitDraft] = useState<number | null>(null)
  const [openConfig, setOpenConfig] = useState<string | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState("")
  const [modelDraft, setModelDraft] = useState("")
  const [reasoningModelDraft, setReasoningModelDraft] = useState("")
  const [baseURLDraft, setBaseURLDraft] = useState("")
  // 草稿为 null 表示"用户还没碰过这一项"：渲染时回落到服务端的值，保存时自然被
  // 排除在请求体之外，正好对上后端"省略即不改"的语义。
  const [speechProviderDraft, setSpeechProviderDraft] = useState<string | null>(null)
  const [speechBaseURLDraft, setSpeechBaseURLDraft] = useState<string | null>(null)
  const [speechKeyDraft, setSpeechKeyDraft] = useState("")
  const [speechModelDraft, setSpeechModelDraft] = useState<string | null>(null)
  const [speechVoiceDraft, setSpeechVoiceDraft] = useState<string | null>(null)
  const [speechFormatDraft, setSpeechFormatDraft] = useState<string | null>(null)
  const [openRoleEditor, setOpenRoleEditor] = useState<string | null>(null)
  const [roleNameDraft, setRoleNameDraft] = useState("")
  const [roleBioDraft, setRoleBioDraft] = useState("")
  const [roleVoiceDraft, setRoleVoiceDraft] = useState("")
  const [roleModelDraft, setRoleModelDraft] = useState("")
  const [roleBaseURLDraft, setRoleBaseURLDraft] = useState("")
  const [avatarVersions, setAvatarVersions] = useState<Record<string, number>>({})
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [applyingUpdate, setApplyingUpdate] = useState(false)
  const [updateError, setUpdateError] = useState("")
  const dailyLimit = dailyLimitDraft ?? settings.dailyLimit

  useEffect(() => {
    void load()
  }, [load])

  // 语音合成单独加载，这样它读不到时诊断信息与备份仍然可用。
  useEffect(() => {
    void loadSpeech()
  }, [loadSpeech])

  if (isLoading && !status) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">正在读取本地诊断信息…</CardContent></Card>
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="grid justify-items-start gap-3 py-8">
          <p role="alert" className="text-sm text-destructive">无法读取系统设置{error ? `（${error}）` : ""}</p>
          <Button variant="outline" onClick={() => void load()}><RefreshCw data-icon="inline-start" />重试</Button>
        </CardContent>
      </Card>
    )
  }

  // One set of drafts backs every vendor's editor, so they are cleared whenever
  // the open vendor changes. Without this, a model id belonging to the previous
  // vendor would be submitted to the next one.
  function toggleVendorConfig(vendorID: string) {
    setOpenConfig(openConfig === vendorID ? null : vendorID)
    setApiKeyDraft("")
    setModelDraft("")
    setReasoningModelDraft("")
    setBaseURLDraft("")
  }

  async function saveVendorSettings(vendorID: string) {
    const values: VendorConfigInput = { provider: vendorID }
    if (apiKeyDraft.trim()) values.api_key = apiKeyDraft.trim()
    if (baseURLDraft.trim()) values.base_url = baseURLDraft.trim()
    if (modelDraft) values.model = modelDraft
    if (reasoningModelDraft) values.reasoning_model = reasoningModelDraft
    await saveConfig(vendorID, values)
    setApiKeyDraft("")
    setOpenConfig(null)
  }

  // 后端的 PATCH 是"省略即不改"，所以只有真被改动过的字段才允许进入请求体，
  // 否则一次保存会把用户没碰过的输入框内容当成新值写回去。
  function speechConfigDiff(): SpeechConfigInput {
    const values: SpeechConfigInput = {}
    if (speechProviderDraft !== null && speechProviderDraft !== (speech?.provider ?? "")) values.provider = speechProviderDraft
    if (speechBaseURLDraft !== null && speechBaseURLDraft.trim() !== (speech?.base_url ?? "")) values.base_url = speechBaseURLDraft.trim()
    if (speechKeyDraft.trim()) values.api_key = speechKeyDraft.trim()
    if (speechModelDraft !== null && speechModelDraft.trim() !== (speech?.model ?? "")) values.model = speechModelDraft.trim()
    if (speechVoiceDraft !== null && speechVoiceDraft.trim() !== (speech?.voice ?? "")) values.voice = speechVoiceDraft.trim()
    if (speechFormatDraft !== null && speechFormatDraft !== (speech?.format ?? "")) values.format = speechFormatDraft
    return values
  }

  // 选中预设时把它的默认值填进输入框，用户仍可以逐个改写。
  function selectSpeechProvider(providerID: string) {
    setSpeechProviderDraft(providerID)
    const spec = speech?.providers?.find((item) => item.id === providerID)
    if (!spec) return
    setSpeechBaseURLDraft(spec.base_url ?? "")
    setSpeechModelDraft(spec.model ?? "")
    setSpeechVoiceDraft(spec.voice ?? "")
  }

  async function saveSpeechEndpoint() {
    const values = speechConfigDiff()
    if (Object.keys(values).length === 0) return
    await saveSpeechSettings(values)
    // 草稿回到"未改动"，输入框随即显示服务端刚确认下来的那份配置。
    setSpeechProviderDraft(null)
    setSpeechBaseURLDraft(null)
    setSpeechKeyDraft("")
    setSpeechModelDraft(null)
    setSpeechVoiceDraft(null)
    setSpeechFormatDraft(null)
  }

  // 一套草稿服务于所有角色编辑器，切换目标时必须重新灌值，否则上一个角色的
  // 发音人会被提交给下一个角色。
  function toggleRoleEditor(role: VoiceRole) {
    if (openRoleEditor === role.id) {
      setOpenRoleEditor(null)
      return
    }
    setOpenRoleEditor(role.id)
    setRoleNameDraft(role.name)
    setRoleBioDraft(role.bio ?? "")
    setRoleVoiceDraft(role.voice ?? "")
    setRoleModelDraft(role.model ?? "")
    setRoleBaseURLDraft(role.base_url ?? "")
  }

  function toggleNewRoleForm() {
    if (openRoleEditor === newVoiceRoleKey) {
      setOpenRoleEditor(null)
      return
    }
    setOpenRoleEditor(newVoiceRoleKey)
    setRoleNameDraft("")
    setRoleBioDraft("")
    setRoleVoiceDraft("")
    setRoleModelDraft("")
    setRoleBaseURLDraft("")
  }

  async function saveNewRole() {
    if (!roleNameDraft.trim()) return
    await addVoiceRole({
      name: roleNameDraft.trim(),
      bio: roleBioDraft.trim(),
      // 留空表示沿用上面的全局预设，角色只覆盖自己填了的那几项。
      provider: "",
      base_url: roleBaseURLDraft.trim(),
      model: roleModelDraft.trim(),
      voice: roleVoiceDraft.trim(),
      sort_order: voiceRoles.length,
    })
    setOpenRoleEditor(null)
  }

  async function saveRole(role: VoiceRole) {
    if (!roleNameDraft.trim()) return
    const patch: VoiceRolePatch = {}
    if (roleNameDraft.trim() !== role.name) patch.name = roleNameDraft.trim()
    if (roleBioDraft.trim() !== (role.bio ?? "")) patch.bio = roleBioDraft.trim()
    if (roleVoiceDraft.trim() !== (role.voice ?? "")) patch.voice = roleVoiceDraft.trim()
    if (roleModelDraft.trim() !== (role.model ?? "")) patch.model = roleModelDraft.trim()
    if (roleBaseURLDraft.trim() !== (role.base_url ?? "")) patch.base_url = roleBaseURLDraft.trim()
    if (Object.keys(patch).length > 0) await editVoiceRole(role.id, patch)
    setOpenRoleEditor(null)
  }

  async function saveRoleAvatar(roleID: string, file?: File | null) {
    if (!file) return
    await changeVoiceRoleAvatar(roleID, file)
    // 新头像写在同一个地址上，不换 URL 浏览器会继续画旧的那张脸。
    setAvatarVersions((versions) => ({ ...versions, [roleID]: Date.now() }))
  }

  // 新增和编辑共用同一组输入框，任一时刻只会渲染一个编辑器，所以 aria-label 不会重名。
  function renderRoleFields(idPrefix: string) {
    return (
      <>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium" htmlFor={`${idPrefix}-name`}>
            名字
            <input
              id={`${idPrefix}-name`}
              type="text"
              aria-label="角色名字"
              value={roleNameDraft}
              onChange={(event) => setRoleNameDraft(event.target.value)}
              placeholder="例如：晓晴"
              className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium" htmlFor={`${idPrefix}-bio`}>
            一句话简介
            <input
              id={`${idPrefix}-bio`}
              type="text"
              aria-label="角色简介"
              value={roleBioDraft}
              onChange={(event) => setRoleBioDraft(event.target.value)}
              placeholder="例如：温柔的中文讲解声音"
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium" htmlFor={`${idPrefix}-voice`}>
            发音人
            <input
              id={`${idPrefix}-voice`}
              type="text"
              aria-label="角色发音人"
              value={roleVoiceDraft}
              onChange={(event) => setRoleVoiceDraft(event.target.value)}
              placeholder={speech?.voice ?? "alloy"}
              className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium" htmlFor={`${idPrefix}-model`}>
            模型
            <input
              id={`${idPrefix}-model`}
              type="text"
              aria-label="角色模型"
              value={roleModelDraft}
              onChange={(event) => setRoleModelDraft(event.target.value)}
              placeholder={speech?.model ?? "gpt-4o-mini-tts"}
              className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
        <label className="grid gap-1 text-xs font-medium" htmlFor={`${idPrefix}-base-url`}>
          接口地址
          <input
            id={`${idPrefix}-base-url`}
            type="text"
            aria-label="角色接口地址"
            value={roleBaseURLDraft}
            onChange={(event) => setRoleBaseURLDraft(event.target.value)}
            placeholder={speech?.base_url ?? "https://api.openai.com/v1"}
            className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </>
    )
  }

  async function checkForUpdate() {
    setCheckingUpdate(true)
    setUpdateError("")
    try {
      setUpdateStatus(await getUpdateStatus())
    } catch {
      setUpdateError("检查更新失败，请确认网络可用。")
    } finally {
      setCheckingUpdate(false)
    }
  }

  async function installUpdate() {
    setApplyingUpdate(true)
    setUpdateError("")
    try {
      await applyUpdate()
      const started = Date.now()
      const timer = window.setInterval(async () => {
        if (Date.now() - started > 180_000) {
          window.clearInterval(timer)
          setApplyingUpdate(false)
          setUpdateError("更新后服务未恢复，请稍后手动打开。")
          return
        }
        try {
          const response = await fetch("/api/health")
          if (response.ok) {
            window.clearInterval(timer)
            window.location.reload()
          }
        } catch {
          // 服务正在重启，继续等待。
        }
      }, 2000)
    } catch {
      setApplyingUpdate(false)
      setUpdateError("更新失败，请检查网络后重试。")
    }
  }

  const speechProvider = speechProviderDraft ?? speech?.provider ?? ""
  const speechBaseURL = speechBaseURLDraft ?? speech?.base_url ?? ""
  const speechModel = speechModelDraft ?? speech?.model ?? ""
  const speechVoice = speechVoiceDraft ?? speech?.voice ?? ""
  const speechFormat = speechFormatDraft ?? speech?.format ?? ""
  const selectedSpeechSpec = speech?.providers?.find((item) => item.id === speechProvider)
  const speechDirty = Object.keys(speechConfigDiff()).length > 0

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><UploadCloud aria-hidden="true" /></div>
            <Button variant="outline" size="sm" disabled={checkingUpdate || applyingUpdate} onClick={() => void checkForUpdate()}>
              <RefreshCw data-icon="inline-start" />{checkingUpdate ? "正在检查…" : "检查更新"}
            </Button>
          </div>
          <CardTitle>更新</CardTitle>
          <CardDescription>当前版本 {status.app.version}，自动检测 GitHub 最新发布。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {updateError ? <p role="alert" className="text-sm text-destructive">{updateError}</p> : null}
          {updateStatus ? (
            updateStatus.update_available ? (
              <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                <p className="text-sm font-medium">发现新版本 {updateStatus.latest_version}</p>
                {updateStatus.release_notes ? (
                  <div className="max-h-32 overflow-auto text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
                    {updateStatus.release_notes}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={applyingUpdate} onClick={() => void installUpdate()}>
                    {applyingUpdate ? "正在后台更新…" : "立即更新"}
                  </Button>
                  {updateStatus.release_url ? (
                    <a className="text-xs text-primary underline underline-offset-3" href={updateStatus.release_url} target="_blank" rel="noreferrer">查看发布说明</a>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-muted/35 px-3 py-2.5 text-sm text-muted-foreground">
                已是最新版本{updateStatus.latest_version ? `（${updateStatus.latest_version}）` : ""}。
                {updateStatus.error ? ` ${updateStatus.error}` : ""}
              </p>
            )
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Bot aria-hidden="true" /></div>
            <Badge variant={status.provider.configured ? "secondary" : "outline"}>{status.provider.configured ? "可用" : "未配置"}</Badge>
          </div>
          <CardTitle>AI 服务商</CardTitle>
          <CardDescription>配置来自 .env.local；切换服务商只改写 AI_ACTIVE_PROVIDER，密钥值永不显示。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {vendors.map((vendor) => {
            // The backend already reports each vendor's [chat, reasoning] models,
            // so the option list is derived rather than hardcoded per vendor.
            const models = vendor.models ?? []
            const modelOptions = models.map((model) => ({ value: model, label: model }))
            const defaultModel = models[0] ?? ""
            const defaultReasoningModel = models[1] ?? defaultModel
            return (
            <div key={vendor.id} className={vendor.active ? "grid gap-2 rounded-xl border border-primary/30 bg-primary/4 px-3 py-2.5" : "grid gap-2 rounded-xl border border-border bg-muted/25 px-3 py-2.5"}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className={vendor.active ? "size-2 shrink-0 rounded-full bg-primary" : vendor.implemented ? "size-2 shrink-0 rounded-full bg-muted-foreground/50" : "size-2 shrink-0 rounded-full border border-muted-foreground/40"} />
                  <strong className="truncate text-sm">{vendor.display_name}</strong>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {vendor.active ? (
                    <Badge variant="default">当前</Badge>
                  ) : vendor.implemented ? (
                    <Badge variant="secondary">已接入</Badge>
                  ) : (
                    <Badge variant="outline">待接入</Badge>
                  )}
                  {vendor.implemented ? (
                    <div className="flex flex-wrap gap-1.5">
                      {!vendor.active ? (
                        <Button size="xs" variant="outline" aria-label={`将 ${vendor.display_name} 设为当前`} onClick={() => void switchProvider(vendor.id)}>设为当前</Button>
                      ) : null}
                      <Button size="xs" variant="outline" aria-label={`测试 ${vendor.display_name} 连通性`} disabled={isTestingProvider} onClick={() => void testProvider(vendor.id)}>
                        测试连通性
                      </Button>
                      {vendor.id === "mock" ? null : (
                        <Button size="xs" variant="ghost" aria-label={`编辑 ${vendor.display_name} 配置`} onClick={() => toggleVendorConfig(vendor.id)}>
                          编辑配置
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
              {vendor.implemented && vendor.id !== "mock" ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck aria-hidden="true" className="size-3.5 text-primary" />
                  {vendor.key_configured ? "API key 已配置（仅显示状态）" : "未配置 API key"}
                </div>
              ) : null}
              {vendor.base_url ? <code className="break-all text-xs text-muted-foreground">{vendor.base_url}</code> : null}
              {vendor.models && vendor.models.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">模型：</span>
                  {vendor.models.map((model) => (
                    <span key={model} className="rounded-md border border-border bg-background/70 px-1.5 py-0.5 font-mono text-[0.68rem] text-muted-foreground">{model}</span>
                  ))}
                </div>
              ) : null}
              {openConfig === vendor.id ? (
                <div className="grid gap-2.5 rounded-lg border border-border bg-background/70 p-2.5">
                  <label className="grid gap-1 text-xs font-medium" htmlFor={`${vendor.id}-api-key`}>
                    API Key
                    <input
                      id={`${vendor.id}-api-key`}
                      type="password"
                      aria-label="API Key"
                      value={apiKeyDraft}
                      onChange={(event) => setApiKeyDraft(event.target.value)}
                      placeholder={vendor.key_configured ? "已配置，留空保持不变" : `输入 ${vendor.display_name} API Key`}
                      className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  {modelOptions.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid gap-1 text-xs font-medium" htmlFor={`${vendor.id}-model`}>
                        模型
                        <Select
                          id={`${vendor.id}-model`}
                          ariaLabel="模型"
                          value={modelDraft}
                          onValueChange={setModelDraft}
                          placeholder={`默认（${defaultModel}）`}
                          options={modelOptions}
                          className="w-full min-w-0"
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium" htmlFor={`${vendor.id}-reasoning-model`}>
                        推理模型
                        <Select
                          id={`${vendor.id}-reasoning-model`}
                          ariaLabel="推理模型"
                          value={reasoningModelDraft}
                          onValueChange={setReasoningModelDraft}
                          placeholder={`默认（${defaultReasoningModel}）`}
                          options={modelOptions}
                          className="w-full min-w-0"
                        />
                      </label>
                    </div>
                  ) : null}
                  <label className="grid gap-1 text-xs font-medium" htmlFor={`${vendor.id}-base-url`}>
                    接口地址
                    <input
                      id={`${vendor.id}-base-url`}
                      type="text"
                      aria-label="接口地址"
                      value={baseURLDraft}
                      onChange={(event) => setBaseURLDraft(event.target.value)}
                      placeholder={vendor.base_url ?? "https://"}
                      className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button size="xs" disabled={isSavingConfig} onClick={() => void saveVendorSettings(vendor.id)}>保存配置</Button>
                    <Button size="xs" variant="outline" disabled={isSavingConfig} onClick={() => void saveConfig(vendor.id, { provider: vendor.id, api_key: "" })}>
                      清除密钥
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            )
          })}
          {providerTestNotice ? <p role="status" aria-live="polite" className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary">{providerTestNotice}</p> : null}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><AudioLines aria-hidden="true" /></div>
            {speech ? <Badge variant={speech.configured ? "secondary" : "outline"}>{speech.configured ? "可用" : "未配置"}</Badge> : null}
          </div>
          <CardTitle>语音合成</CardTitle>
          <CardDescription>兼容任意 OpenAI 风格的音频接口——OpenAI、OpenRouter、Groq、SiliconFlow、Azure 或本地服务。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {speechError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span>{speechError}</span>
              <Button variant="outline" size="xs" onClick={() => void loadSpeech()}>重新读取</Button>
            </div>
          ) : null}
          {!speech ? (
            speechError ? null : <p className="text-sm text-muted-foreground">正在读取语音合成配置…</p>
          ) : (
            <>
              <div className="grid gap-2.5 rounded-xl border border-border bg-muted/25 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="size-3.5 text-primary" />
                  <strong className="text-sm">默认接口</strong>
                  <span className="text-xs text-muted-foreground">{speech.key_configured ? "密钥已配置（仅显示状态）" : "尚未配置密钥"}</span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-medium" htmlFor="speech-provider">
                    服务预设
                    <Select
                      id="speech-provider"
                      ariaLabel="语音服务预设"
                      value={speechProvider}
                      onValueChange={selectSpeechProvider}
                      placeholder="选择一个预设"
                      options={speech.providers.map((item) => ({ value: item.id, label: item.display_name }))}
                      className="w-full min-w-0"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium" htmlFor="speech-format">
                    音频格式
                    <Select
                      id="speech-format"
                      ariaLabel="音频格式"
                      value={speechFormat}
                      onValueChange={setSpeechFormatDraft}
                      placeholder="默认（WAV）"
                      options={speechFormatOptions}
                      className="w-full min-w-0"
                    />
                  </label>
                </div>
                <label className="grid gap-1 text-xs font-medium" htmlFor="speech-base-url">
                  接口地址
                  <input
                    id="speech-base-url"
                    type="text"
                    aria-label="语音接口地址"
                    value={speechBaseURL}
                    onChange={(event) => setSpeechBaseURLDraft(event.target.value)}
                    placeholder={selectedSpeechSpec?.base_url ?? "https://api.openai.com/v1"}
                    className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                {selectedSpeechSpec?.endpoint_hint ? <p className="text-xs text-muted-foreground">{selectedSpeechSpec.endpoint_hint}</p> : null}
                <label className="grid gap-1 text-xs font-medium" htmlFor="speech-api-key">
                  接口密钥
                  <input
                    id="speech-api-key"
                    type="password"
                    aria-label="语音合成 API Key"
                    value={speechKeyDraft}
                    onChange={(event) => setSpeechKeyDraft(event.target.value)}
                    placeholder="留空保持不变"
                    className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                {selectedSpeechSpec?.local ? <p className="text-xs text-muted-foreground">本地服务通常不需要 API Key。</p> : null}
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-medium" htmlFor="speech-model">
                    模型
                    <input
                      id="speech-model"
                      type="text"
                      aria-label="语音模型"
                      value={speechModel}
                      onChange={(event) => setSpeechModelDraft(event.target.value)}
                      placeholder={selectedSpeechSpec?.model ?? "gpt-4o-mini-tts"}
                      className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium" htmlFor="speech-voice">
                    发音人
                    <input
                      id="speech-voice"
                      type="text"
                      aria-label="默认发音人"
                      value={speechVoice}
                      onChange={(event) => setSpeechVoiceDraft(event.target.value)}
                      placeholder={selectedSpeechSpec?.voice ?? "alloy"}
                      className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                </div>
                {selectedSpeechSpec?.voice_hint ? <p className="text-xs text-muted-foreground">可用发音人：{selectedSpeechSpec.voice_hint}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="xs" disabled={isSavingSpeech || !speechDirty} onClick={() => void saveSpeechEndpoint()}>保存语音配置</Button>
                  <Button size="xs" variant="outline" disabled={isSavingSpeech} onClick={() => void saveSpeechSettings({ api_key: "" })}>清除语音密钥</Button>
                </div>
              </div>

              <div className="grid gap-2 rounded-xl border border-border bg-muted/25 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users aria-hidden="true" className="size-3.5 text-primary" />
                    <strong className="text-sm">语音角色</strong>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeVoiceRoleId ? (
                      <Button size="xs" variant="ghost" aria-label="取消当前语音角色" onClick={() => void activateVoiceRole("")}>恢复默认发音</Button>
                    ) : null}
                    <Button size="xs" variant="outline" onClick={() => toggleNewRoleForm()}>新增角色</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">每个角色可以有自己的头像、简介和发音配置，留空的字段沿用上面的默认接口。</p>

                {openRoleEditor === newVoiceRoleKey ? (
                  <div className="grid gap-2.5 rounded-lg border border-primary/30 bg-background/70 p-2.5">
                    {renderRoleFields("new-role")}
                    <p className="text-xs text-muted-foreground">保存后即可为它上传头像。</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="xs" disabled={isSavingSpeech || !roleNameDraft.trim()} onClick={() => void saveNewRole()}>创建角色</Button>
                      <Button size="xs" variant="ghost" onClick={() => toggleNewRoleForm()}>取消</Button>
                    </div>
                  </div>
                ) : null}

                {voiceRoles.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">还没有语音角色，新增一个即可随时切换。</p>
                ) : voiceRoles.map((role) => (
                  <div key={role.id} className={role.id === activeVoiceRoleId ? "grid gap-2 rounded-lg border border-primary/30 bg-primary/4 px-2.5 py-2" : "grid gap-2 rounded-lg border border-border bg-background/70 px-2.5 py-2"}>
                    <div className="flex flex-wrap items-center gap-2.5">
                      {role.has_avatar ? (
                        <img
                          src={voiceRoleAvatarURL(role.id, avatarVersions[role.id] ?? role.updated_at)}
                          alt={`${role.name} 的头像`}
                          className="size-9 shrink-0 rounded-full border border-border object-cover"
                        />
                      ) : (
                        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-medium text-primary">{role.name.slice(0, 1)}</span>
                      )}
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <strong className="truncate text-sm">{role.name}</strong>
                          {role.id === activeVoiceRoleId ? <Badge variant="default">当前</Badge> : null}
                        </div>
                        <span className="truncate text-xs text-muted-foreground">{role.bio?.trim() ? role.bio : "尚无简介"}</span>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {role.id === activeVoiceRoleId ? null : (
                          <Button size="xs" variant="outline" aria-label={`将 ${role.name} 设为当前角色`} onClick={() => void activateVoiceRole(role.id)}>设为当前</Button>
                        )}
                        <Button size="xs" variant="ghost" aria-label={`编辑 ${role.name}`} onClick={() => toggleRoleEditor(role)}>编辑</Button>
                        <Button size="xs" variant="ghost" aria-label={`删除 ${role.name}`} disabled={isSavingSpeech} onClick={() => void removeVoiceRole(role.id)}>删除</Button>
                      </div>
                    </div>
                    {role.voice || role.model || role.base_url ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {role.voice ? <span className="rounded-md border border-border bg-background/70 px-1.5 py-0.5 font-mono text-[0.68rem]">{role.voice}</span> : null}
                        {role.model ? <span className="rounded-md border border-border bg-background/70 px-1.5 py-0.5 font-mono text-[0.68rem]">{role.model}</span> : null}
                        {role.base_url ? <code className="break-all text-[0.68rem]">{role.base_url}</code> : null}
                      </div>
                    ) : null}
                    {openRoleEditor === role.id ? (
                      <div className="grid gap-2.5 rounded-lg border border-border bg-background/70 p-2.5">
                        {renderRoleFields(`role-${role.id}`)}
                        <label className="grid gap-1 text-xs font-medium" htmlFor={`role-${role.id}-avatar`}>
                          头像
                          <input
                            id={`role-${role.id}-avatar`}
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp"
                            aria-label={`上传 ${role.name} 的头像`}
                            disabled={isSavingSpeech}
                            onChange={(event) => void saveRoleAvatar(role.id, event.target.files?.[0])}
                            className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </label>
                        <p className="text-xs text-muted-foreground">支持 PNG / JPG / GIF / WebP，不超过 2MB。</p>
                        <div className="flex flex-wrap gap-2">
                          <Button size="xs" disabled={isSavingSpeech || !roleNameDraft.trim()} aria-label={`保存 ${role.name}`} onClick={() => void saveRole(role)}>保存角色</Button>
                          <Button size="xs" variant="ghost" onClick={() => toggleRoleEditor(role)}>取消</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
          {speechNotice ? <p role="status" aria-live="polite" className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary">{speechNotice}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Save aria-hidden="true" /></div>
          <CardTitle>记忆节奏</CardTitle>
          <CardDescription>限制每天安排的记忆量，避免单次任务过载。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void saveDailyLimit(dailyLimit) }}>
            <label htmlFor="daily-limit" className="grid gap-1.5 text-sm font-medium">
              每日记忆上限
              <Input
                id="daily-limit"
                aria-label="每日记忆上限"
                type="number"
                min={MIN_DAILY_LIMIT}
                max={MAX_DAILY_LIMIT}
                value={dailyLimit}
                onChange={(event) => setDailyLimitDraft(normalizeDailyLimit(Number(event.target.value)))}
              />
            </label>
            <p className="text-xs text-muted-foreground">允许范围：{MIN_DAILY_LIMIT}–{MAX_DAILY_LIMIT} 个。</p>
            <Button type="submit" className="w-fit" disabled={isSaving}>{isSaving ? "保存中…" : "保存设置"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Database aria-hidden="true" /></div>
          <CardTitle>本地数据</CardTitle>
          <CardDescription>学习记录默认留在当前设备。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="grid gap-1 rounded-lg bg-muted/45 px-3 py-2"><span className="text-muted-foreground">数据目录</span><code className="break-all text-xs">{status.data.directory}</code></div>
          <div className="grid gap-1 rounded-lg bg-muted/45 px-3 py-2"><span className="text-muted-foreground">数据库</span><code className="break-all text-xs">{status.data.database_path}</code></div>
          <p className="text-xs text-muted-foreground">学习系统 {status.app.version} · {platformLabel(status.app.platform)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><HardDrive aria-hidden="true" /></div>
            <Button variant="outline" size="sm" disabled={isBackingUp} onClick={() => void createDailyBackup()}>
              <Download data-icon="inline-start" />{isBackingUp ? "备份中…" : "立即备份"}
            </Button>
          </div>
          <CardTitle>备份记录</CardTitle>
          <CardDescription>{status.backup.count} 份记录 · 最近：{formatDate(status.backup.last_created_at)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {backups.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">尚无备份记录</p>
          ) : backups.map((backup) => (
            <div key={backup.id} className="grid gap-1 rounded-lg bg-muted/45 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3"><strong>{backup.category === "daily" ? "日常备份" : "更新前备份"}</strong><span className="text-xs text-muted-foreground">{formatBytes(backup.size_bytes)}</span></div>
              <span className="text-xs text-muted-foreground">{formatDate(backup.created_at)}</span>
              <code className="truncate text-xs" title={backup.path}>{backup.path}</code>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">位置：{status.backup.directory}</p>
        </CardContent>
      </Card>

      {error ? (
        <div role="alert" className="lg:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw data-icon="inline-start" />重试</Button>
        </div>
      ) : null}
      {notice ? <p aria-live="polite" className="lg:col-span-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-primary">{notice}</p> : null}
    </div>
  )
}
