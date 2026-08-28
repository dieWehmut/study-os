import type { KnowledgeItem } from "@/api/types"

export const ENGLISH_MASTERY_DIMENSIONS = [
  "recognition",
  "comprehension",
  "retrieval",
  "use",
] as const

export type EnglishMasteryDimension = (typeof ENGLISH_MASTERY_DIMENSIONS)[number]

export type EnglishQuestionType = {
  id: string
  label: string
  dimension: EnglishMasteryDimension
  /** The persisted prompt type when this task maps to a review card. */
  promptType: string
  description: string
}

export interface EnglishQuestionGroup {
  dimension: EnglishMasteryDimension
  label: string
  questions: EnglishQuestionType[]
}

export interface EnglishDimensionState {
  dimension: EnglishMasteryDimension
  state: "missing" | "untested" | "self_reported" | "needs_work" | "partial" | "demonstrated"
}

const dimensionLabels: Record<EnglishMasteryDimension, string> = {
  recognition: "识别",
  comprehension: "理解",
  retrieval: "提取",
  use: "运用",
}

function commonQuestions(item: KnowledgeItem): EnglishQuestionGroup[] {
  const example = item.example?.trim()
  return [
    {
      dimension: "recognition",
      label: dimensionLabels.recognition,
      questions: [
        {
          id: "meaning-choice",
          label: "英文选中文",
          dimension: "recognition",
          promptType: "en_to_zh",
          description: `看到 “${item.term}” 说出核心意思。`,
        },
        {
          id: "audio-choice",
          label: "听音选词",
          dimension: "recognition",
          promptType: "audio_to_term",
          description: "只听读音，在相近词中选出目标词。",
        },
      ],
    },
    {
      dimension: "comprehension",
      label: dimensionLabels.comprehension,
      questions: [
        {
          id: "context-meaning",
          label: "语境辨义",
          dimension: "comprehension",
          promptType: "context_cloze",
          description: example ? `在例句中判断 “${item.term}” 的具体含义。` : "把词放回一句话中判断具体含义。",
        },
        {
          id: "part-of-speech",
          label: "词性判断",
          dimension: "comprehension",
          promptType: "part_of_speech",
          description: "根据句中位置判断词性与语义角色。",
        },
      ],
    },
    {
      dimension: "retrieval",
      label: dimensionLabels.retrieval,
      questions: [
        {
          id: "meaning-recall",
          label: "中文默写英文",
          dimension: "retrieval",
          promptType: "zh_to_en",
          description: `看到释义“${item.concise_definition}”写出英文。`,
        },
        {
          id: "first-letter-gap",
          label: "首字母填空",
          dimension: "retrieval",
          promptType: "initial_gap",
          description: "保留首字母和语境线索，提取完整词形。",
        },
      ],
    },
    {
      dimension: "use",
      label: dimensionLabels.use,
      questions: [
        {
          id: "sentence-production",
          label: "造句",
          dimension: "use",
          promptType: "make_sentence",
          description: `用 “${item.term}” 写一句符合语境的英文。`,
        },
        {
          id: "translation-production",
          label: "翻译改写",
          dimension: "use",
          promptType: "translation",
          description: "把一个中文情境改写成包含目标词的英文。",
        },
      ],
    },
  ]
}

function phraseQuestions(item: KnowledgeItem): EnglishQuestionType[] {
  return [
    {
      id: "collocation-gap",
      label: "搭配补全",
      dimension: "comprehension",
      promptType: "collocation_gap",
      description: `补出与 “${item.term}” 一起使用的固定搭配。`,
    },
    {
      id: "chunk-order",
      label: "词块排序",
      dimension: "use",
      promptType: "chunk_order",
      description: "把打乱的词块还原成自然表达。",
    },
  ]
}

/**
 * Build the available checks without changing review data. The matrix is a
 * catalogue of observable abilities; scheduling remains the responsibility of
 * the existing review API.
 */
export function buildEnglishQuestionMatrix(item: KnowledgeItem): EnglishQuestionGroup[] {
  if (item.subject?.trim().toLowerCase() !== "english") return []

  const groups = commonQuestions(item)
  const phraseLike = ["phrase", "collocation", "expression"].includes(item.item_type.trim().toLowerCase())
  if (!phraseLike) return groups

  return groups.map((group) => {
    const extras = phraseQuestions(item).filter((question) => question.dimension === group.dimension)
    return extras.length > 0 ? { ...group, questions: [...group.questions, ...extras] } : group
  })
}

const statePriority: Record<EnglishDimensionState["state"], number> = {
  needs_work: 0,
  partial: 1,
  missing: 2,
  self_reported: 3,
  untested: 4,
  demonstrated: 99,
}

/** Pick one concrete check for each dimension that still needs evidence. */
export function recommendedEnglishQuestionTypes(
  matrix: EnglishQuestionGroup[],
  states: EnglishDimensionState[],
): EnglishQuestionType[] {
  const groups = new Map(matrix.map((group) => [group.dimension, group]))
  return states
    .filter((entry) => entry.state !== "demonstrated")
    .sort((left, right) => statePriority[left.state] - statePriority[right.state])
    .flatMap((entry) => {
      const first = groups.get(entry.dimension)?.questions[0]
      return first ? [first] : []
    })
}
