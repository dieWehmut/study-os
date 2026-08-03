import { useEffect, useState } from "react"
import { Bot, Database, Download, HardDrive, RefreshCw, Save, ShieldCheck } from "lucide-react"

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

export default function SettingsPanel() {
  const {
    settings,
    status,
    backups,
    vendors,
    isTestingProvider,
    providerTestNotice,
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
  } = useSettingsStore()
  const [dailyLimitDraft, setDailyLimitDraft] = useState<number | null>(null)
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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
            </div>
          ))}
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
          <p className="text-xs text-muted-foreground">Study OS {status.app.version} · {status.app.platform}</p>
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
