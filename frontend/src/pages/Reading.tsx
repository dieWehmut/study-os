import { useMemo, useState } from "react"
import { Network, ScanText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { MindMap } from "@/features/mindmap/MindMap"
import { FocusReader } from "@/features/reading/FocusReader"
import { StructurePreview } from "@/features/reading/StructurePreview"
import { chunkMarkdown } from "@/lib/chunk"
import { markdownToMindMap } from "@/lib/mindmap"
import { readReadingSession, writeReadingSession, type ReadingSession } from "@/lib/reading-session"

export default function Reading() {
  const [showMap, setShowMap] = useState(false)
  // The document, the place and the marks travel together, because a mark
  // names a chunk id and chunk ids come from the document's own shape.
  const [session, setSession] = useState<ReadingSession>(readReadingSession)
  const { markdown } = session

  const chunks = useMemo(() => chunkMarkdown(markdown), [markdown])
  // The same headings the outline is built from, drawn sideways. No model, and
  // no second paste box to keep in sync with this one.
  const map = useMemo(() => markdownToMindMap(markdown), [markdown])
  const readIds = useMemo(() => new Set(session.readIds), [session.readIds])
  // A place stored against a longer draft has to land somewhere real in this
  // one, or the reader points at a stop that is not there.
  const index = Math.min(session.index, Math.max(chunks.length - 1, 0))

  function save(next: ReadingSession) {
    setSession(next)
    writeReadingSession(next)
  }

  function toggleRead(id: string) {
    if (readIds.has(id)) {
      // Taking a mark back is a correction, and moving you would carry you away
      // from the stop you came back to fix.
      save({ ...session, index, readIds: session.readIds.filter((entry) => entry !== id) })
      return
    }
    // Marking a stop and then reaching for 下一节 is two actions for one intent.
    save({
      markdown,
      index: Math.min(index + 1, chunks.length - 1),
      readIds: [...session.readIds, id],
    })
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ScanText aria-hidden="true" className="size-4 text-primary" />
        <h1 className="font-heading text-2xl font-semibold tracking-tight">阅读</h1>
      </div>

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>原文</CardTitle>
          <p className="text-sm text-muted-foreground">
            粘贴讲义或笔记。用 <code className="text-xs">#</code> 标题分节效果最好。
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            aria-label="原文"
            value={markdown}
            onChange={(event) => {
              // A new document has a new set of stops; keeping the old position
              // would drop the reader somewhere arbitrary in it, and the old
              // marks would attach to stops nobody has read.
              save({ markdown: event.target.value, index: 0, readIds: [] })
            }}
            placeholder={"# 标题\n## 小节\n正文…"}
            className="min-h-40 font-mono text-xs"
          />
          {map.nodes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowMap((open) => !open)}>
                <Network data-icon="inline-start" />{showMap ? "收起导图" : "看导图"}
              </Button>
              <span className="text-xs text-muted-foreground">层级来自标题，没有经过模型改写</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Folded away by default: the outline, the prose and a full map all at
          once is the same wall of information the preview exists to avoid. */}
      {showMap && map.nodes.length > 0 ? (
        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle>{map.title}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {map.nodes.length} 个节点 · 点一个分支可以折叠它，先看整体再展开细节。
            </p>
          </CardHeader>
          <CardContent>
            <MindMap data={map} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,19rem)_1fr]">
        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle>结构</CardTitle>
            <p className="text-sm text-muted-foreground">
              先看这一栏：有几站、多深、多重。
            </p>
          </CardHeader>
          <CardContent>
            <StructurePreview
              markdown={markdown}
              activeId={chunks[index]?.id}
              readIds={readIds}
              onSelect={(chunk) =>
                save({ ...session, index: chunks.findIndex((item) => item.id === chunk.id) })
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle>正文</CardTitle>
            <p className="text-sm text-muted-foreground">
              一次只放一节，方向键翻页。
            </p>
          </CardHeader>
          <CardContent>
            <FocusReader
              chunks={chunks}
              index={index}
              onIndexChange={(next) => save({ ...session, index: next })}
              onToggleRead={toggleRead}
              readIds={readIds}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
