import { useDeferredValue, useState } from "react"

import { Textarea } from "@/components/ui/textarea"
import { MarkdownPreview, type VocabularySelection } from "./MarkdownPreview"
import { VocabularyPopover } from "./VocabularyPopover"

export interface MarkdownWorkspaceProps {
  markdown: string
  onMarkdownChange(value: string): void
}

export function MarkdownWorkspace({ markdown, onMarkdownChange }: MarkdownWorkspaceProps) {
  const deferredMarkdown = useDeferredValue(markdown)
  const [selection, setSelection] = useState<VocabularySelection | null>(null)

  function updateMarkdown(value: string) {
    setSelection(null)
    onMarkdownChange(value)
  }

  return (
    <div
      data-testid="markdown-workspace"
      className="grid min-w-0 gap-4 lg:grid-cols-2"
    >
      <section className="flex min-h-64 min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 ring-1 ring-foreground/5 lg:h-[clamp(24rem,56vh,42rem)]">
        <label htmlFor="reading-markdown-source" className="text-sm font-medium">原文</label>
        <Textarea
          id="reading-markdown-source"
          aria-label="原文"
          value={markdown}
          onChange={(event) => updateMarkdown(event.target.value)}
          className="min-h-64 flex-1 resize-none overflow-auto font-mono text-xs leading-6 lg:min-h-0"
        />
      </section>

      <section
        role="region"
        aria-label="Markdown 实时预览"
        className="min-h-64 min-w-0 rounded-xl border bg-card p-4 ring-1 ring-foreground/5 lg:h-[clamp(24rem,56vh,42rem)] lg:overflow-auto"
      >
        <MarkdownPreview
          markdown={deferredMarkdown}
          onVocabularySelect={setSelection}
        />
      </section>

      <VocabularyPopover selection={selection} onClose={() => setSelection(null)} />
    </div>
  )
}
