import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ReadingChunk } from "@/lib/chunk"

interface FocusReaderProps {
  chunks: ReadingChunk[]
  index: number
  onIndexChange: (index: number) => void
}

/**
 * One stop at a time.
 *
 * The structure preview spends the cost of the document's shape up front; this
 * is what that buys. With a single chunk on screen there is nothing else
 * competing for working memory, and the heading path above it means the chunk
 * still says where in the document you are standing -- which is the one piece
 * of context reading in isolation would otherwise cost you.
 */
export function FocusReader({ chunks, index, onIndexChange }: FocusReaderProps) {
  const chunk = chunks[index]

  if (!chunk) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        选一个小节开始读。
      </p>
    )
  }

  const trail = chunk.path.slice(0, -1).join(" / ")
  const hasPrevious = index > 0
  const hasNext = index < chunks.length - 1

  function move(delta: number) {
    const next = index + delta
    if (next < 0 || next >= chunks.length) return
    onIndexChange(next)
  }

  return (
    <div
      role="region"
      aria-label="正文"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") move(1)
        else if (event.key === "ArrowLeft") move(-1)
        else return
        event.preventDefault()
      }}
      className="flex flex-col gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-col gap-0.5">
        {trail ? <p className="truncate text-xs text-muted-foreground">{trail}</p> : null}
        <h2 className="font-heading text-lg font-semibold tracking-tight">{chunk.title}</h2>
      </div>

      <div className="flex flex-col gap-2 text-[0.95rem] leading-8">
        {chunk.lines.map((line, lineIndex) => (
          <p key={lineIndex}>{line}</p>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrevious}
          onClick={() => move(-1)}
          aria-label="上一节"
        >
          <ChevronLeft aria-hidden="true" />
          上一节
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {index + 1} / {chunks.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={!hasNext}
          onClick={() => move(1)}
          aria-label="下一节"
        >
          下一节
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
