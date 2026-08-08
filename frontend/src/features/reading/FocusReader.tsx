import { BookmarkPlus, Check, ChevronLeft, ChevronRight, HelpCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ReadingChunk } from "@/lib/chunk"

interface FocusReaderProps {
  chunks: ReadingChunk[]
  index: number
  onIndexChange: (index: number) => void
  /** Omit to hide the toggle: a control nobody records would forget the answer. */
  onToggleRead?: (id: string) => void
  readIds?: ReadonlySet<string>
  /** Same rule as onToggleRead: no store, no control. */
  onToggleStuck?: (id: string) => void
  stuckIds?: ReadonlySet<string>
  /**
   * Send this section somewhere it will be reviewed. Not a toggle like the
   * other two: it leaves the page, and there is no taking it back from here.
   */
  onKeep?: (id: string) => void
  keptIds?: ReadonlySet<string>
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
export function FocusReader({
  chunks,
  index,
  onIndexChange,
  onToggleRead,
  readIds,
  onToggleStuck,
  stuckIds,
  onKeep,
  keptIds,
}: FocusReaderProps) {
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
  // Keyed by the chunk's id, not by the index: arriving at stop 2 must not
  // inherit stop 1's mark, or the record would claim a page you never opened.
  const isRead = readIds?.has(chunk.id) ?? false
  // Deliberately independent of isRead. Reading a section through and still not
  // having it is the common case, not a contradiction to rule out.
  const isStuck = stuckIds?.has(chunk.id) ?? false
  const isKept = keptIds?.has(chunk.id) ?? false

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

      {/* Wraps rather than squeezing: four verdicts and two page turns do not
          fit one line on a phone, and a control pushed off the edge is a
          control you do not have. */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {onToggleStuck ? (
            // Unlike 读完 this does not turn the page. Saying a stop did not
            // land is the opposite claim to being done with it, and carrying
            // you away from it would be the last thing you wanted.
            <Button
              variant={isStuck ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={isStuck}
              onClick={() => onToggleStuck(chunk.id)}
              className={isStuck ? "text-amber-700 dark:text-amber-400" : undefined}
            >
              <HelpCircle aria-hidden="true" />
              {isStuck ? "卡住了" : "没看懂"}
            </Button>
          ) : null}
          {onKeep ? (
            // Disabled once kept rather than hidden: a control that vanishes
            // leaves you unsure whether it fired or you missed it. There is no
            // undo here, so this is the one action on the row that does not
            // toggle back.
            <Button
              variant="ghost"
              size="sm"
              disabled={isKept}
              onClick={() => onKeep(chunk.id)}
              className={isKept ? "text-emerald-700 dark:text-emerald-400" : undefined}
            >
              <BookmarkPlus aria-hidden="true" />
              {isKept ? "已收进" : "收进知识库"}
            </Button>
          ) : null}
          {onToggleRead ? (
            <Button
              variant={isRead ? "default" : "outline"}
              size="sm"
              aria-pressed={isRead}
              onClick={() => onToggleRead(chunk.id)}
            >
              <Check aria-hidden="true" />
              {isRead ? "已读完" : "读完"}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={() => move(1)}
            aria-label="下一节"
          >
            下一节
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  )
}
