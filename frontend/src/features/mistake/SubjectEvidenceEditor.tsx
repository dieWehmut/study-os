import { useState } from "react"
import { LoaderCircle, Save } from "lucide-react"

import { updateMistakeEvidence } from "@/api/mistakes"
import { Button } from "@/components/ui/button"
import { EquationBoard, type EquationBoardValue } from "@/features/chemistry/EquationBoard"
import { ScoringBoard, type ScoringBoardValue } from "@/features/chinese/ScoringBoard"
import { LongSentenceBoard, type LongSentenceBoardValue } from "@/features/english/LongSentenceBoard"
import { ChainBoard, type ChainBoardValue } from "@/features/geography/ChainBoard"
import { DerivationBoard, type DerivationBoardValue } from "@/features/math/DerivationBoard"
import { FreeBodyBoard, type FreeBodyBoardValue } from "@/features/physics/FreeBodyBoard"
import { MotionBoard, type MotionBoardValue } from "@/features/physics/MotionBoard"
import {
  normalizeSubjectAttemptEvidence,
  type CausalChainEvidence,
  type DerivationEvidence,
  type EquationEvidence,
  type FreeBodyEvidence,
  type LongSentenceEvidence,
  type MistakeEvidence,
  type MotionEvidence,
  type ScoringPointsEvidence,
} from "@/lib/mistake-evidence"
import type { MistakeRecord } from "@/lib/mistakes"

import { subjectEvidenceToolFor, type SubjectEvidenceTool } from "./subject-evidence"

const editorCopy: Record<SubjectEvidenceTool, { title: string; hint: string }> = {
  scoring_points: { title: "对照得分点", hint: "把标准得分点和自己的答案放在一起，找出漏掉的那一类。" },
  derivation: { title: "定位推导断点", hint: "逐行写下过程，保留真正开始偏离的那一步。" },
  long_sentence: { title: "拆解长难句", hint: "先找主干，再看从句怎样挂在主句上。" },
  free_body: { title: "重画受力图", hint: "先列接触力，再补场力，检查方向与合力。" },
  motion: { title: "拆分运动阶段", hint: "按状态变化分段，逐段记录初末状态。" },
  equation: { title: "回查化学方程式", hint: "重新检查配平、元素守恒和状态符号。" },
  causal_chain: { title: "补全因果链", hint: "一环一环写出成因和结果，暴露中间缺口。" },
}

export interface SubjectEvidenceEditorProps {
  record: MistakeRecord
  onSaved?: (record: MistakeRecord) => void
}

function emptyEvidence(kind: SubjectEvidenceTool): MistakeEvidence {
  switch (kind) {
    case "scoring_points":
      return { version: 1, subject: "chinese", tool: kind, data: { points: [], answer: "" } }
    case "derivation":
      return { version: 1, subject: "math", tool: kind, data: { lines: [] } }
    case "long_sentence":
      return { version: 1, subject: "english", tool: kind, data: { sentence: "" } }
    case "free_body":
      return { version: 1, subject: "physics", tool: kind, data: { forces: [] } }
    case "motion":
      return { version: 1, subject: "physics", tool: kind, data: { stages: [] } }
    case "equation":
      return { version: 1, subject: "chemistry", tool: kind, data: { equation: "" } }
    case "causal_chain":
      return { version: 1, subject: "geography", tool: kind, data: { links: [] } }
  }
}

function initialEvidence(record: MistakeRecord, kind: SubjectEvidenceTool): MistakeEvidence {
  const saved = record.evidence
  if (saved?.tool === kind && saved.subject === record.subject.trim().toLowerCase()) return saved
  return emptyEvidence(kind)
}

function EditorBody({ record, kind, onSaved }: SubjectEvidenceEditorProps & { kind: SubjectEvidenceTool }) {
  const [draft, setDraft] = useState<MistakeEvidence>(() => initialEvidence(record, kind))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function change(next: MistakeEvidence) {
    setDraft(next)
    setSaved(false)
    setError(null)
  }

  async function save() {
    setError(null)
    setSaved(false)

    let evidence: MistakeEvidence | undefined
    try {
      evidence = normalizeSubjectAttemptEvidence(record.subject, draft)
    } catch {
      setError("请先完整填写诊断内容，再保存这次学习证据。")
      return
    }
    if (!evidence) {
      setError("请先完整填写诊断内容，再保存这次学习证据。")
      return
    }

    setSaving(true)
    try {
      const updated = await updateMistakeEvidence(record.id, evidence)
      setDraft(evidence)
      setSaved(true)
      onSaved?.(updated)
    } catch (reason) {
      const detail = reason instanceof Error && reason.message.trim() ? `：${reason.message}` : ""
      setError(`保存失败，请稍后再试${detail}`)
    } finally {
      setSaving(false)
    }
  }

  const copy = editorCopy[kind]
  return (
    <section className="grid gap-3 rounded-xl border bg-muted/15 p-3" aria-labelledby={`evidence-${record.id}`}>
      <div className="grid gap-0.5">
        <h3 id={`evidence-${record.id}`} className="text-sm font-medium">{copy.title}</h3>
        <p className="text-xs text-muted-foreground">{copy.hint}</p>
      </div>

      <EvidenceBoard kind={kind} draft={draft} onChange={change} />

      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <div className="flex min-h-8 items-center justify-end gap-2">
        {saved ? <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">已保存</p> : null}
        <Button type="button" size="sm" disabled={saving} aria-busy={saving} onClick={save}>
          {saving ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Save aria-hidden="true" />}
          {saving ? "保存中…" : "保存诊断证据"}
        </Button>
      </div>
    </section>
  )
}

function EvidenceBoard({
  kind,
  draft,
  onChange,
}: {
  kind: SubjectEvidenceTool
  draft: MistakeEvidence
  onChange: (evidence: MistakeEvidence) => void
}) {
  switch (kind) {
    case "scoring_points": {
      const evidence = draft as ScoringPointsEvidence
      return (
        <ScoringBoard
          initialValue={evidence.data}
          onChange={(data: ScoringBoardValue) => onChange({ version: 1, subject: "chinese", tool: kind, data })}
        />
      )
    }
    case "derivation": {
      const evidence = draft as DerivationEvidence
      return (
        <DerivationBoard
          initialValue={evidence.data}
          onChange={(data: DerivationBoardValue) => onChange({ version: 1, subject: "math", tool: kind, data })}
        />
      )
    }
    case "long_sentence": {
      const evidence = draft as LongSentenceEvidence
      return (
        <LongSentenceBoard
          initialValue={evidence.data}
          onChange={(data: LongSentenceBoardValue) => onChange({ version: 1, subject: "english", tool: kind, data })}
        />
      )
    }
    case "free_body": {
      const evidence = draft as FreeBodyEvidence
      return (
        <FreeBodyBoard
          initialValue={evidence.data}
          onChange={(data: FreeBodyBoardValue) => onChange({ version: 1, subject: "physics", tool: kind, data })}
        />
      )
    }
    case "motion": {
      const evidence = draft as MotionEvidence
      const initialValue: MotionBoardValue = {
        stages: evidence.data.stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          v0: stage.v0 ?? null,
          v: stage.v ?? null,
          a: stage.a ?? null,
          t: stage.t ?? null,
          x: stage.x ?? null,
          derived: stage.derived ? [...stage.derived] : [],
        })),
      }
      return (
        <MotionBoard
          initialValue={initialValue}
          onChange={(data: MotionBoardValue) => onChange({ version: 1, subject: "physics", tool: kind, data })}
        />
      )
    }
    case "equation": {
      const evidence = draft as EquationEvidence
      return (
        <EquationBoard
          initialValue={evidence.data}
          onChange={(data: EquationBoardValue) => onChange({ version: 1, subject: "chemistry", tool: kind, data })}
        />
      )
    }
    case "causal_chain": {
      const evidence = draft as CausalChainEvidence
      return (
        <ChainBoard
          initialValue={evidence.data}
          onChange={(data: ChainBoardValue) => onChange({ version: 1, subject: "geography", tool: kind, data })}
        />
      )
    }
  }
}

export function SubjectEvidenceEditor({ record, onSaved }: SubjectEvidenceEditorProps) {
  const kind = subjectEvidenceToolFor(record)
  if (!kind) {
    return <p className="text-xs text-muted-foreground">这个错因暂时没有适用的学科诊断工具。</p>
  }

  return <EditorBody key={`${record.id}:${kind}`} record={record} kind={kind} onSaved={onSaved} />
}
