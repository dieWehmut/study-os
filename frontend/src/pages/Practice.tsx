import { SquarePen } from "lucide-react"

import { PagePlaceholder } from "@/components/layout/PagePlaceholder"

export default function Practice() {
  return (
    <PagePlaceholder
      eyebrow="检测空间"
      title="把练习过程留下来"
      description="集中处理检测题、错因分类与反馈记录，为后续学习决策提供证据。"
      icon={SquarePen}
    />
  )
}
