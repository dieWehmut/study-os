import { LibraryBig } from "lucide-react"

import { PagePlaceholder } from "@/components/layout/PagePlaceholder"

export default function Knowledge() {
  return (
    <PagePlaceholder
      eyebrow="知识 Wiki"
      title="整理每一个值得记忆的知识点"
      description="词汇、短语与隐性结论会在这里形成简明卡片和详细 Wiki。"
      icon={LibraryBig}
    />
  )
}
