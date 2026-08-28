import { useEffect, useMemo, useState } from "react"
import { Activity, ListChecks } from "lucide-react"

import {
  getKnowledgeMastery,
  type EnglishMasteryDimensionEvidence,
  type EnglishMasteryProjection,
  type MasteryState,
} from "@/api/knowledge"
import type { KnowledgeItem } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import {
  buildEnglishQuestionMatrix,
  recommendedEnglishQuestionTypes,
  type EnglishMasteryDimension,
} from "@/lib/english-question-matrix"

interface EnglishMasteryPanelProps {
  item: KnowledgeItem
}

const stateLabels: Record<MasteryState, string> = {
  missing: "缺少证据",
  untested: "待作答",
  self_reported: "仅自评",
  needs_work: "需加强",
  partial: "部分掌握",
  demonstrated: "已验证",
}

const stateVariants: Record<MasteryState, "default" | "secondary" | "destructive" | "outline"> = {
  missing: "outline",
  untested: "secondary",
  self_reported: "outline",
  needs_work: "destructive",
  partial: "secondary",
  demonstrated: "default",
}

function missingEvidence(dimension: EnglishMasteryDimension): EnglishMasteryDimensionEvidence {
  return {
    dimension,
    prompt_types: [],
    state: "missing",
    evidence_kind: "none",
    prompt_count: 0,
    attempt_count: 0,
  }
}

export function EnglishMasteryPanel({ item }: EnglishMasteryPanelProps) {
  const isEnglish = item.subject?.trim().toLowerCase() === "english"
  const matrix = useMemo(() => buildEnglishQuestionMatrix(item), [item])
  const [masteryRequest, setMasteryRequest] = useState<{
    itemID: string
    projection: EnglishMasteryProjection | null
    status: "ready" | "error"
  } | null>(null)

  useEffect(() => {
    if (!isEnglish) return
    let active = true
    void getKnowledgeMastery(item.id)
      .then((result) => {
        if (!active) return
        setMasteryRequest({ itemID: item.id, projection: result, status: "ready" })
      })
      .catch(() => {
        if (!active) return
        setMasteryRequest({ itemID: item.id, projection: null, status: "error" })
      })
    return () => {
      active = false
    }
  }, [isEnglish, item.id])

  if (!isEnglish || matrix.length === 0) return null

  const currentRequest = masteryRequest?.itemID === item.id ? masteryRequest : null
  const projection = currentRequest?.projection ?? null
  const evidenceByDimension = new Map(
    projection?.dimensions.map((entry) => [entry.dimension, entry]),
  )
  const evidence = matrix.map((group) =>
    evidenceByDimension.get(group.dimension) ?? missingEvidence(group.dimension),
  )
  const recommendations = recommendedEnglishQuestionTypes(matrix, evidence)
  const firstRecommendation = recommendations[0]

  return (
    <section aria-labelledby={`english-mastery-${item.id}`} className="grid gap-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Activity aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="grid gap-1">
            <h2 id={`english-mastery-${item.id}`} className="text-sm font-semibold">英语掌握度</h2>
            <p className="text-xs leading-5 text-muted-foreground">
              同一个词分开检查识别、理解、提取和运用，避免“看着眼熟”被当作真正掌握。
            </p>
          </div>
        </div>
        {!currentRequest ? <span className="text-xs text-muted-foreground">正在读取证据…</span> : null}
      </div>

      {currentRequest?.status === "error" ? (
        <p role="status" className="text-xs text-muted-foreground">
          掌握证据暂未同步，仍可按题型逐项检查。
        </p>
      ) : null}

      <div role="list" aria-label="英语能力维度" className="grid gap-2">
        {matrix.map((group) => {
          const dimensionEvidence = evidenceByDimension.get(group.dimension) ?? missingEvidence(group.dimension)
          return (
            <div
              key={group.dimension}
              role="listitem"
              className="grid min-h-20 gap-2 rounded-lg border bg-background px-3 py-2.5 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-start"
            >
              <div className="flex items-center justify-between gap-2 sm:grid sm:justify-start">
                <h3 className="text-sm font-medium">{group.label}</h3>
                <Badge variant={stateVariants[dimensionEvidence.state]}>{stateLabels[dimensionEvidence.state]}</Badge>
              </div>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {group.questions.map((question) => (
                  <span
                    key={question.id}
                    title={question.description}
                    className="inline-flex min-h-6 items-center rounded-md border bg-muted/30 px-2 text-xs text-muted-foreground"
                  >
                    {question.label}
                  </span>
                ))}
              </div>
              <span className="text-xs tabular-nums text-muted-foreground sm:pt-1">
                {dimensionEvidence.attempt_count > 0 ? `${dimensionEvidence.attempt_count} 次作答` : "暂无作答"}
              </span>
            </div>
          )
        })}
      </div>

      {firstRecommendation ? (
        <div className="flex items-start gap-2 border-t pt-3 text-sm">
          <ListChecks aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            <span className="font-medium">优先检查：{firstRecommendation.label}</span>
            <span className="ml-2 text-xs leading-5 text-muted-foreground">{firstRecommendation.description}</span>
          </p>
        </div>
      ) : (
        <p className="border-t pt-3 text-sm font-medium text-primary">四个维度都有可观察证据。</p>
      )}
    </section>
  )
}
