import type { LucideIcon } from "lucide-react"
import {
  BookOpenText,
  BrainCircuit,
  House,
  Settings2,
  SquarePen,
} from "lucide-react"

export interface NavigationItem {
  description: string
  icon: LucideIcon
  label: string
  path: string
}

export const primaryNavigation: NavigationItem[] = [
  { path: "/", label: "今日", description: "今天的学习入口", icon: House },
  { path: "/knowledge", label: "知识库", description: "词汇与知识 Wiki", icon: BookOpenText },
  { path: "/memory", label: "记忆", description: "按计划完成复习", icon: BrainCircuit },
  { path: "/practice", label: "练习", description: "集中检测与反馈", icon: SquarePen },
  { path: "/settings", label: "设置", description: "偏好、数据与诊断", icon: Settings2 },
]

export function navigationForPath(pathname: string): NavigationItem {
  return (
    primaryNavigation.find((item) =>
      item.path === "/" ? pathname === "/" : pathname.startsWith(item.path),
    ) ?? primaryNavigation[0]
  )
}
