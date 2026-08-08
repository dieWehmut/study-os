import type { LucideIcon } from "lucide-react"
import {
  BookOpenText,
  BrainCircuit,
  House,
  Import as ImportIcon,
  MessagesSquare,
  Network,
  ScanText,
  Settings2,
} from "lucide-react"

export interface NavigationItem {
  description: string
  icon: LucideIcon
  label: string
  path: string
}

// Order encodes the two phases: 阅读 prepares material you have not met yet,
// 记忆 returns to material you have. Preview sits before review.
export const primaryNavigation: NavigationItem[] = [
  { path: "/", label: "首页", description: "今天的学习入口", icon: House },
  { path: "/knowledge", label: "知识库", description: "词汇与知识 Wiki", icon: BookOpenText },
  { path: "/reading", label: "阅读", description: "先看结构，再读正文", icon: ScanText },
  { path: "/memory", label: "记忆", description: "按计划完成复习", icon: BrainCircuit },
  { path: "/integrate", label: "整合", description: "导图与卡片整合", icon: Network },
  { path: "/chat", label: "答疑", description: "随时问 AI，后台异步回答", icon: MessagesSquare },
  { path: "/import", label: "导入", description: "导入与整理学习资料", icon: ImportIcon },
  { path: "/settings", label: "设置", description: "偏好、数据与诊断", icon: Settings2 },
]

export function navigationForPath(pathname: string): NavigationItem {
  return (
    primaryNavigation.find((item) =>
      item.path === "/" ? pathname === "/" : pathname === item.path || pathname.startsWith(`${item.path}/`),
    ) ?? primaryNavigation[0]
  )
}
