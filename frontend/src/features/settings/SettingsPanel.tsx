import { useEffect, useState } from "react"
import { Bot, Database, Download, HardDrive, RefreshCw, Save, ShieldCheck, UploadCloud } from "lucide-react"

import type { VendorConfigInput } from "@/api/agent"
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
    load,
    saveDailyLimit,
    createDailyBackup,
    switchProvider,
    testProvider,
    saveConfig,
  } = useSettingsStore()
  const [dailyLimitDraft, setDailyLimitDraft] = useState<number | null>(null)
  const [openConfig, setOpenConfig] = useState<string | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState("")
  const [modelDraft, setModelDraft] = useState("")
  const [reasoningModelDraft, setReasoningModelDraft] = useState("")
  const [baseURLDraft, setBaseURLDraft] = useState("")
  const [ttsKeyDraft, setTtsKeyDraft] = useState("")
  const [ttsVoiceDraft, setTtsVoiceDraft] = useState("")
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [applyingUpdate, setApplyingUpdate] = useState(false)
  const [updateError, setUpdateError] = useState("")
  const dailyLimit = dailyLimitDraft ?? settings.dailyLimit

  useEffect(() => {
    void load()
  }, [load])

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

  async function saveDeepSeekConfig() {
    const values: VendorConfigInput = { provider: "deepseek" }
    if (apiKeyDraft.trim()) values.api_key = apiKeyDraft.trim()
    if (baseURLDraft.trim()) values.base_url = baseURLDraft.trim()
    if (modelDraft) values.model = modelDraft
    if (reasoningModelDraft) values.reasoning_model = reasoningModelDraft
    await saveConfig("deepseek", values)
    setApiKeyDraft("")
    setOpenConfig(null)
  }

  async function saveTTSConfig() {
    const values: VendorConfigInput = { provider: "dashscope" }
    if (ttsKeyDraft.trim()) values.api_key = ttsKeyDraft.trim()
    if (ttsVoiceDraft.trim()) values.voice = ttsVoiceDraft.trim()
    await saveConfig("dashscope", values)
    setTtsKeyDraft("")
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
          {vendors.map((vendor) => (
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
                        <Button size="xs" variant="outline" onClick={() => void switchProvider(vendor.id)}>设为当前</Button>
                      ) : null}
                      <Button size="xs" variant="outline" disabled={isTestingProvider} onClick={() => void testProvider(vendor.id)}>
                        测试连通性
                      </Button>
                      {vendor.id === "deepseek" ? (
                        <Button size="xs" variant="ghost" onClick={() => setOpenConfig(openConfig === "deepseek" ? null : "deepseek")}>
                          编辑配置
                        </Button>
                      ) : null}
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
              {vendor.id === "deepseek" && openConfig === "deepseek" ? (
                <div className="grid gap-2.5 rounded-lg border border-border bg-background/70 p-2.5">
                  <label className="grid gap-1 text-xs font-medium" htmlFor="ds-api-key">
                    API Key
                    <input
                      id="ds-api-key"
                      type="password"
                      aria-label="API Key"
                      value={apiKeyDraft}
                      onChange={(event) => setApiKeyDraft(event.target.value)}
                      placeholder={vendor.key_configured ? "已配置，留空保持不变" : "输入 DeepSeek API Key"}
                      className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-xs font-medium" htmlFor="ds-model">
                      模型
                      <Select
                        id="ds-model"
                        ariaLabel="模型"
                        value={modelDraft}
                        onValueChange={setModelDraft}
                        placeholder="默认（deepseek-v4-flash）"
                        options={[
                          { value: "deepseek-v4-flash", label: "deepseek-v4-flash" },
                          { value: "deepseek-v4-pro", label: "deepseek-v4-pro" },
                        ]}
                        className="w-full min-w-0"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-medium" htmlFor="ds-reasoning-model">
                      推理模型
                      <Select
                        id="ds-reasoning-model"
                        ariaLabel="推理模型"
                        value={reasoningModelDraft}
                        onValueChange={setReasoningModelDraft}
                        placeholder="默认（deepseek-v4-pro）"
                        options={[
                          { value: "deepseek-v4-pro", label: "deepseek-v4-pro" },
                          { value: "deepseek-v4-flash", label: "deepseek-v4-flash" },
                        ]}
                        className="w-full min-w-0"
                      />
                    </label>
                  </div>
                  <label className="grid gap-1 text-xs font-medium" htmlFor="ds-base-url">
                    接口地址
                    <input
                      id="ds-base-url"
                      type="text"
                      aria-label="接口地址"
                      value={baseURLDraft}
                      onChange={(event) => setBaseURLDraft(event.target.value)}
                      placeholder="https://api.deepseek.com/v1"
                      className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button size="xs" disabled={isSavingConfig} onClick={() => void saveDeepSeekConfig()}>保存配置</Button>
                    <Button size="xs" variant="outline" disabled={isSavingConfig} onClick={() => void saveConfig("deepseek", { provider: "deepseek", api_key: "" })}>
                      清除密钥
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          <div className="grid gap-2 rounded-xl border border-border bg-muted/25 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-muted-foreground/50" />
              <strong className="text-sm">云端发音（CosyVoice）</strong>
            </div>
            <label className="grid gap-1 text-xs font-medium" htmlFor="tts-api-key">
              TTS API Key
              <input
                id="tts-api-key"
                type="password"
                aria-label="TTS API Key"
                value={ttsKeyDraft}
                onChange={(event) => setTtsKeyDraft(event.target.value)}
                placeholder="输入 DashScope API Key（留空保持不变）"
                className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium" htmlFor="tts-voice">
              发音人
              <input
                id="tts-voice"
                type="text"
                aria-label="发音人"
                value={ttsVoiceDraft}
                onChange={(event) => setTtsVoiceDraft(event.target.value)}
                placeholder="longxiaochun"
                className="h-8 rounded-md border border-border bg-background px-2.5 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="xs" disabled={isSavingConfig} onClick={() => void saveTTSConfig()}>保存发音配置</Button>
            </div>
          </div>
          {providerTestNotice ? <p role="status" aria-live="polite" className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary">{providerTestNotice}</p> : null}
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
