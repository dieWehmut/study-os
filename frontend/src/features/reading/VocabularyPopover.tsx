import { useEffect, useRef, useState } from "react"
import { BookOpen, LoaderCircle, RefreshCw, X } from "lucide-react"

import { lookupVocabulary } from "@/api/knowledge"
import type { KnowledgeItem } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import type { VocabularySelection } from "./MarkdownPreview"

const vocabularyCache = new Map<string, KnowledgeItem>()

function cacheKey(selection: VocabularySelection): string {
  return `${selection.kind}:${selection.term.normalize("NFKC").trim().toLocaleLowerCase()}`
}

function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 639px)").matches
      : false,
  )

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const media = window.matchMedia("(max-width: 639px)")
    const update = () => setNarrow(media.matches)
    media.addEventListener?.("change", update)
    media.addListener?.(update)
    return () => {
      media.removeEventListener?.("change", update)
      media.removeListener?.(update)
    }
  }, [])

  return narrow
}

function panelPosition(anchor: HTMLElement): { top: number; left: number } {
  const rect = anchor.getBoundingClientRect()
  const gutter = 12
  const width = 360
  const viewportWidth = typeof window === "undefined" ? width + gutter * 2 : window.innerWidth
  const viewportHeight = typeof window === "undefined" ? 640 : window.innerHeight
  const left = Math.min(Math.max(gutter, rect.left), Math.max(gutter, viewportWidth - width - gutter))
  const below = rect.bottom + gutter
  const estimatedHeight = 300
  const top = below + estimatedHeight <= viewportHeight - gutter
    ? below
    : Math.max(gutter, rect.top - estimatedHeight - gutter)
  return { top, left }
}

export interface VocabularyPopoverProps {
  selection: VocabularySelection | null
  onClose(): void
}

export function VocabularyPopover({ selection, onClose }: VocabularyPopoverProps) {
  if (!selection) return null
  return <VocabularyPopoverPanel key={`${cacheKey(selection)}:${selection.context}`} selection={selection} onClose={onClose} />
}

interface VocabularyPopoverPanelProps {
  selection: VocabularySelection
  onClose(): void
}

function VocabularyPopoverPanel({ selection, onClose }: VocabularyPopoverPanelProps) {
  const narrow = useNarrowViewport()
  const panelRef = useRef<HTMLDivElement>(null)
  const versionRef = useRef(0)
  const key = cacheKey(selection)
  const cached = vocabularyCache.get(key)
  const [item, setItem] = useState<KnowledgeItem | null>(cached ?? null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(cached ? "ready" : "loading")
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [position, setPosition] = useState(() => panelPosition(selection.anchor))

  useEffect(() => {
    const update = () => setPosition(panelPosition(selection.anchor))
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [selection.anchor])

  useEffect(() => {
    const version = ++versionRef.current
    if (vocabularyCache.has(key)) return () => { versionRef.current += 1 }

    void lookupVocabulary({
      term: selection.term,
      context: selection.context,
      kind: selection.kind,
    }).then((response) => {
      if (version !== versionRef.current) return
      vocabularyCache.set(key, response.item)
      setItem(response.item)
      setStatus("ready")
      setError(null)
    }).catch(() => {
      if (version !== versionRef.current) return
      setStatus("error")
      setError("\u67e5\u8be2\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002")
    })

    return () => {
      versionRef.current += 1
    }
  }, [key, retryNonce, selection.context, selection.kind, selection.term])

  useEffect(() => {
    if (narrow) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && (panelRef.current?.contains(target) || selection.anchor.contains(target))) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    panelRef.current?.focus()
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [narrow, onClose, selection.anchor])

  const content = (
    <div
      tabIndex={-1}
      className="flex max-h-[min(32rem,calc(100vh-1.5rem))] flex-col gap-3 overflow-auto p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose()
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-medium leading-none">{selection.display}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">{selection.kind === "expression" ? "\u77ed\u8bed" : "\u5355\u8bcd"}</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={"\u5173\u95ed"} title={"\u5173\u95ed"} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </div>

      {status === "loading" ? (
        <div role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {"\u6b63\u5728\u67e5\u8be2\u8bcd\u4e49\u2026"}
        </div>
      ) : status === "error" ? (
        <div className="flex flex-col gap-3 py-2">
          <p role="alert" className="text-sm text-destructive">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null)
              setStatus("loading")
              setRetryNonce((value) => value + 1)
            }}
          >
            <RefreshCw data-icon="inline-start" />
            {"\u91cd\u8bd5"}
          </Button>
        </div>
      ) : item ? (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {item.part_of_speech ? <span>{item.part_of_speech}</span> : null}
            {item.pronunciation ? <span>{item.pronunciation}</span> : null}
          </div>
          <p className="text-base leading-7">{item.concise_definition}</p>
          {item.example ? <p className="border-l-2 border-primary/30 pl-3 text-muted-foreground">{item.example}</p> : null}
          <a
            href={`/knowledge?item=${encodeURIComponent(item.id)}`}
            className="inline-flex w-fit items-center gap-1.5 text-primary underline-offset-4 hover:underline"
          >
            <BookOpen aria-hidden="true" className="size-4" />
            {"\u5728\u77e5\u8bc6\u5e93\u67e5\u770b"}
          </a>
        </div>
      ) : null}
    </div>
  )

  if (narrow) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent
          showCloseButton={false}
          aria-label={`\u67e5\u8bcd ${selection.display}`}
          className="inset-x-0 bottom-0 top-auto left-0 w-full max-w-none translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none p-0"
          onKeyDown={(event) => { if (event.key === "Escape") onClose() }}
        >
          {content}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`\u67e5\u8bcd ${selection.display}`}
      tabIndex={-1}
      className="fixed z-50 w-[min(22.5rem,calc(100vw-1.5rem))] rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      style={{ top: position.top, left: position.left }}
      onKeyDown={(event) => { if (event.key === "Escape") onClose() }}
    >
      {content}
    </div>
  )
}
