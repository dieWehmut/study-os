import { Import as ImportIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ImportWizard } from "@/features/import/ImportWizard"

export default function Import() {
  return (
    <section className="grid gap-6">
      <div className="grid gap-2">
        <Badge variant="secondary" className="w-fit"><ImportIcon aria-hidden="true" />资料导入</Badge>
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">把已有资料整理成可学习的知识</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">上传 CSV、JSONL 或 SQLite，检查字段、预览去重结果，再提交到本地知识库。</p>
      </div>
      <ImportWizard />
    </section>
  )
}
