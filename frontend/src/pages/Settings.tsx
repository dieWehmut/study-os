import { Settings2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import SettingsPanel from "@/features/settings/SettingsPanel"

export default function Settings() {
  return (
    <section className="grid gap-6">
      <div className="grid gap-2">
        <Badge variant="secondary" className="w-fit"><Settings2 aria-hidden="true" />本地配置</Badge>
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">控制学习节奏与数据边界</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">管理每日上限、AI 提供商状态、本地数据与可验证备份。主题切换继续保存在当前设备。</p>
      </div>
      <SettingsPanel />
    </section>
  )
}
