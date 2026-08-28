import { useCallback, useEffect, useState } from "react"
import { Copy, ListTree, Network, RefreshCw, Wand2 } from "lucide-react"

import { createIntegrate, getIntegrateNote, listIntegrateNotes, type IntegratedNote, type MindMap as MindMapData } from "@/api/integrate"
import { listKnowledge } from "@/api/knowledge"
import type { KnowledgeItem } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { MindMap } from "@/features/mindmap/MindMap"
import { toMermaid as exportMermaid } from "@/lib/mermaid"
import { markdownToMindMap } from "@/lib/mindmap"
import { SubjectChips } from "@/features/subjects/SubjectChips"
import { subjectName } from "@/lib/subjects"
import { useSubjectStore } from "@/store/useSubjectStore"
import { CapabilityCatalog } from "@/features/whiteboard/CapabilityCatalog"

function cardTypeLabel(cardType: string): string {
  switch (cardType) {
    case "conclusion":
      return "二级结论"
    case "trap":
      return "易错信号"
    case "strategy":
      return "解题策略"
    case "formula":
      return "公式卡"
    default:
      return "概念卡"
  }
}

export default function Integrate() {
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [knowledgeID, setKnowledgeID] = useState("")
  const [text, setText] = useState("")
  const [note, setNote] = useState<IntegratedNote | null>(null)
  const [structure, setStructure] = useState<MindMapData | null>(null)
  const [history, setHistory] = useState<IntegratedNote[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  const refreshHistory = useCallback(() => {
    return listIntegrateNotes(subject === "all" ? "" : subject, 20)
      .then((result) => setHistory(result.items))
      .catch(() => {
        // 历史加载失败不阻塞生成。
      })
  }, [subject])

  useEffect(() => {
    let active = true
    listKnowledge({ limit: 100, offset: 0, subject: subject === "all" ? undefined : subject })
      .then((result) => {
        if (active) setItems(result.items)
      })
      .catch(() => {
        if (active) setItems([])
      })
    void refreshHistory()
    return () => {
      active = false
    }
  }, [subject, refreshHistory])

  async function generate() {
    const trimmed = text.trim()
    if (generating) return
    if (!trimmed && !knowledgeID) {
      setError("请输入一段资料，或选择一个知识点。")
      return
    }
    setGenerating(true)
    setError("")
    try {
      const result = await createIntegrate({
        subject: subject === "all" ? "" : subject,
        text: trimmed || undefined,
        knowledge_id: knowledgeID || undefined,
        max_cards: 12,
      })
      setNote(result)
      setStructure(null)
      await refreshHistory()
    } catch {
      setError("整合生成失败，请确认 AI 服务已配置或稍后重试。")
    } finally {
      setGenerating(false)
    }
  }

  /**
   * The same picture, drawn from the document instead of from a model.
   *
   * Headings and indentation already say what the shape is, so this needs no
   * network call and returns the same tree every time -- which is what makes a
   * map worth studying before you read. The AI path stays for material that has
   * no headings to work from.
   */
  function buildFromStructure() {
    const trimmed = text.trim()
    if (!trimmed) {
      setError("请先粘贴一段带标题的资料。")
      return
    }
    // No title override here: supplying one tells the parser the document is
    // untitled, which would demote its own level-1 heading to a mere section.
    const map = markdownToMindMap(trimmed)
    if (map.nodes.length === 0) {
      setError("这段文字没有标题层级，无法按结构分层。可以先加上 # 标题，或改用 AI 生成。")
      return
    }
    setError("")
    setStructure(map)
    setNote(null)
  }

  async function loadHistory(noteID: string) {
    try {
      setNote(await getIntegrateNote(noteID))
      setStructure(null)
    } catch {
      setError("读取历史笔记失败。")
    }
  }

  async function copyMermaid() {
    const map = structure ?? note?.mindmap
    if (!map) return
    try {
      await navigator.clipboard.writeText(exportMermaid(map))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError("复制失败，请手动选择文本。")
    }
  }

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Network aria-hidden="true" className="size-4 text-primary" />
        <h1 className="font-heading text-2xl font-semibold tracking-tight">整合</h1>
      </div>
      <SubjectChips subject={subject} onSelect={setSubject} />

      <CapabilityCatalog />

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>把资料变成导图 + 卡片</CardTitle>
          <p className="text-sm text-muted-foreground">输入一段讲义、笔记或知识点，AI 会自动分层成导图节点，并拆成一张卡一个主题的卡片。</p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Select
            ariaLabel="从知识点生成"
            value={knowledgeID}
            onValueChange={setKnowledgeID}
            placeholder="或从已有知识点生成（可选）"
            options={items.map((item) => ({ value: item.id, label: item.term }))}
            className="w-full min-w-0"
          />
          <textarea
            aria-label="整合资料来源"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="粘贴讲义/笔记/错题解析…（与知识点二选一即可）"
            className="min-h-32 resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={generating || (!text.trim() && !knowledgeID)} onClick={() => void generate()}>
              <Wand2 data-icon="inline-start" />{generating ? "生成中…" : "生成导图与卡片"}
            </Button>
            <Button variant="outline" disabled={!text.trim()} onClick={buildFromStructure}>
              <ListTree data-icon="inline-start" />按结构生成（不调用 AI）
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            资料本身带 <code>#</code> 标题时优先用「按结构生成」：层级来自原文，每次结果一致，适合正式阅读前先看一遍。
          </p>
        </CardContent>
      </Card>

      {structure ? (
        <Card>
          <CardHeader className="gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{structure.title}</CardTitle>
              <Button size="sm" variant="outline" onClick={() => void copyMermaid()}>
                <Copy data-icon="inline-start" />{copied ? "已复制" : "复制 Mermaid"}
              </Button>
            </div>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">来自原文结构</Badge>
              <span>{structure.nodes.length} 个节点 · 层级由标题决定，没有经过模型改写</span>
            </p>
          </CardHeader>
          <CardContent>
            <MindMap data={structure} />
          </CardContent>
        </Card>
      ) : null}

      {note ? (
        <div className="grid gap-4">
          <Card>
            <CardHeader className="gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{note.title}</CardTitle>
                <Button size="sm" variant="outline" onClick={() => void copyMermaid()}>
                  <Copy data-icon="inline-start" />{copied ? "已复制" : "复制 Mermaid"}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {note.subject ? subjectName(note.subject) : "综合"} · 导图节点 {note.mindmap.nodes.length} 个 · 卡片 {note.cards.length} 张
              </p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <MindMap data={note.mindmap} />
              <div className="grid gap-3 sm:grid-cols-2">
                {note.cards.map((card) => (
                  <div key={card.id} className="grid gap-1.5 rounded-xl border border-border bg-muted/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{card.title}</p>
                      <Badge variant="secondary">{cardTypeLabel(card.card_type)}</Badge>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">{card.body}</p>
                    {card.tags?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {card.tags.map((tag) => <span key={tag} className="rounded-md bg-background/70 px-1.5 py-0.5 text-[0.68rem] text-muted-foreground">#{tag}</span>)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="gap-1.5">
          <CardTitle>历史整合</CardTitle>
          <p className="text-sm text-muted-foreground">点击查看之前生成过的导图与卡片</p>
        </CardHeader>
        <CardContent className="grid gap-2">
          {history.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              还没有整合记录。用上面的来源生成第一份吧。
            </p>
          ) : (
            history.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => void loadHistory(entry.id)}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <span className="truncate text-sm font-medium">{entry.title}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw aria-hidden="true" className="size-3" />
                  {entry.mindmap.nodes.length} 节点 · {entry.cards.length} 卡
                </span>
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  )
}
