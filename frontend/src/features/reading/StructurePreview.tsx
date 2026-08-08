import { Check, CornerDownRight, ListTree } from "lucide-react"

import { chunkMarkdown, type ReadingChunk } from "@/lib/chunk"
import { cn } from "@/lib/utils"

interface StructurePreviewProps {
  markdown: string
  /** The chunk the reader currently has open, if any. */
  activeId?: string
  onSelect?: (chunk: ReadingChunk) => void
  /** Omit while nobody is tracking a read: a 已读 0 / 3 on an untouched
   *  document is noise standing where the shape goes. */
  readIds?: ReadonlySet<string>
}

/**
 * The skeleton of a document, shown before its prose.
 *
 * Reading a long stretch cold means holding the structure and the content at
 * the same time. Seeing the stops first -- how many, how deep, how heavy, and
 * roughly what each opens with -- spends that effort once, up front, so the
 * actual read only has to carry the content.
 */
export function StructurePreview({
  markdown,
  activeId,
  onSelect,
  readIds,
}: StructurePreviewProps) {
  const chunks = chunkMarkdown(markdown)

  if (chunks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        粘贴一段讲义或笔记，这里会先给出它的结构。
      </p>
    )
  }

  // The cost of the whole document, before the first stop. Per-stop weights
  // answer "is this one long?"; only the total answers "can I afford this
  // right now?" -- and depth is the other half of it, since ten flat sections
  // and ten nested three deep are nothing like the same read.
  const total = chunks.reduce((sum, chunk) => sum + chunk.size, 0)
  const levels = Math.max(...chunks.map((chunk) => chunk.path.length - 1))
  const readCount = readIds ? chunks.filter((chunk) => readIds.has(chunk.id)).length : 0

  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        <ListTree aria-hidden="true" className="size-3.5" />
        <span>{chunks.length} 个小节</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">共 {total} 字</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{levels} 层</span>
        {readIds ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums font-medium text-primary">
              已读 {readCount} / {chunks.length}
            </span>
          </>
        ) : null}
      </p>
      <ol className="flex flex-col gap-1.5">
        {chunks.map((chunk, index) => {
          // Depth comes from the heading path, so the indent is the document's
          // own shape rather than a guess. The root title is path[0] and is the
          // same for everything, so it contributes no indent.
          const depth = Math.max(0, chunk.path.length - 2)
          const current = chunk.id === activeId
          const read = readIds?.has(chunk.id) ?? false
          return (
            <li key={chunk.id} style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
              <button
                type="button"
                data-depth={depth}
                aria-current={current}
                onClick={() => onSelect?.(chunk)}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
                  current
                    ? "border-primary/60 bg-primary/5"
                    : "border-border bg-muted/25 hover:bg-muted/50",
                  // Done stops recede rather than disappear: you still need to
                  // find your way back to one, but they should not compete for
                  // attention with the part you have not read.
                  read && !current ? "opacity-70" : null,
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className={cn("truncate text-sm font-medium", read ? "line-through" : null)}>
                    {chunk.title}
                  </span>
                  {read ? (
                    <span className="flex shrink-0 items-center gap-0.5 text-[0.68rem] text-primary">
                      <Check aria-hidden="true" className="size-3" />已读
                    </span>
                  ) : null}
                  {chunk.continues ? (
                    <span className="flex shrink-0 items-center gap-0.5 text-[0.68rem] text-muted-foreground">
                      <CornerDownRight aria-hidden="true" className="size-3" />接上节
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                    {chunk.size} 字
                  </span>
                </span>
                {chunk.gist ? (
                  <span className="truncate pl-7 text-xs text-muted-foreground">{chunk.gist}</span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
