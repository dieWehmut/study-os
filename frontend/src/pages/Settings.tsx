import { Settings2 } from "lucide-react"

import { PagePlaceholder } from "@/components/layout/PagePlaceholder"

export default function Settings() {
  return (
    <PagePlaceholder
      eyebrow="本地配置"
      title="控制学习节奏与数据边界"
      description="管理主题、每日上限、AI 提供商状态、本地数据与备份。"
      icon={Settings2}
    />
  )
}
