import { describe, expect, it } from "vitest"

import type { KnowledgeItem } from "@/api/types"

import {
  ENGLISH_MASTERY_DIMENSIONS,
  buildEnglishQuestionMatrix,
  recommendedEnglishQuestionTypes,
} from "./english-question-matrix"

const word: KnowledgeItem = {
  id: "word-abandon",
  item_type: "word_sense",
  subject: "english",
  term: "abandon",
  part_of_speech: "verb",
  concise_definition: "放弃；遗弃",
  example: "They abandoned the plan after the cost doubled.",
}

describe("English question matrix", () => {
  it("covers recognition, comprehension, retrieval and use with distinct tasks", () => {
    const matrix = buildEnglishQuestionMatrix(word)

    expect(matrix.map((group) => group.dimension)).toEqual(ENGLISH_MASTERY_DIMENSIONS)
    expect(matrix.every((group) => group.questions.length >= 2)).toBe(true)
    expect(new Set(matrix.flatMap((group) => group.questions.map((question) => question.id))).size)
      .toBe(matrix.flatMap((group) => group.questions).length)
    expect(matrix.find((group) => group.dimension === "recognition")?.questions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ promptType: "en_to_zh" })]))
    expect(matrix.find((group) => group.dimension === "retrieval")?.questions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ promptType: "zh_to_en" })]))
    expect(matrix.find((group) => group.dimension === "use")?.questions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ promptType: "make_sentence" })]))
  })

  it("uses phrase-specific collocation and chunk tasks", () => {
    const matrix = buildEnglishQuestionMatrix({
      ...word,
      id: "phrase-take-part-in",
      item_type: "phrase",
      term: "take part in",
      concise_definition: "参加",
    })
    const questions = matrix.flatMap((group) => group.questions)

    expect(questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "chunk-order", label: "词块排序" }),
      expect.objectContaining({ id: "collocation-gap", label: "搭配补全" }),
    ]))
  })

  it("recommends only the weak dimensions and never treats self-report as demonstrated", () => {
    const recommendations = recommendedEnglishQuestionTypes(buildEnglishQuestionMatrix(word), [
      { dimension: "recognition", state: "self_reported" },
      { dimension: "comprehension", state: "demonstrated" },
      { dimension: "retrieval", state: "needs_work" },
      { dimension: "use", state: "missing" },
    ])

    expect(recommendations.map((question) => question.dimension)).toEqual([
      "retrieval",
      "use",
      "recognition",
    ])
    expect(recommendations.some((question) => question.dimension === "comprehension")).toBe(false)
  })

  it("returns no English matrix for another subject", () => {
    expect(buildEnglishQuestionMatrix({ ...word, subject: "math" })).toEqual([])
  })
})
