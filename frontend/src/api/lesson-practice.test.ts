import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

import {
  listLessonPracticeAttempts,
  normalizeLessonPracticeAttempt,
  submitLessonPracticeAttempt,
} from "./lesson-practice"

describe("lesson practice API", () => {
  beforeEach(() => mocks.apiRequest.mockReset())

  it("posts an answer and elapsed time to the lesson section route", async () => {
    mocks.apiRequest.mockResolvedValue({
      id: "la-1",
      lesson_id: "lesson/1",
      section_id: "practice/1",
      answer: "8 N",
      evaluation: "correct",
      reference_answer: "8 N",
      feedback: "答对了",
      elapsed_ms: 250,
      created_at: "2026-08-20T00:00:00Z",
    })

    await expect(submitLessonPracticeAttempt("lesson/1", "practice/1", { answer: "8 N", elapsedMs: 250 }))
      .resolves.toMatchObject({ id: "la-1", evaluation: "correct", elapsed_ms: 250 })
    expect(mocks.apiRequest).toHaveBeenCalledWith("/lessons/lesson%2F1/practice/practice%2F1/attempts", {
      method: "POST",
      body: JSON.stringify({ answer: "8 N", elapsed_ms: 250 }),
    })
  })

  it("defaults omitted elapsed time to zero", async () => {
    mocks.apiRequest.mockResolvedValue({
      id: "la-4",
      lesson_id: "lesson-1",
      section_id: "practice-1",
      answer: "8 N",
      evaluation: "correct",
      elapsed_ms: 0,
    })

    await submitLessonPracticeAttempt("lesson-1", "practice-1", { answer: "8 N" })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/lessons/lesson-1/practice/practice-1/attempts", {
      method: "POST",
      body: JSON.stringify({ answer: "8 N", elapsed_ms: 0 }),
    })
  })

  it("lists attempts in the response order and derives a missing count", async () => {
    mocks.apiRequest.mockResolvedValue({
      items: [{ attempt_id: "la-2", evaluation: "ungraded", answer: "自述", elapsed_ms: 0 }],
    })

    await expect(listLessonPracticeAttempts("lesson-1", "practice-1")).resolves.toEqual({
      count: 1,
      items: [expect.objectContaining({ id: "la-2", evaluation: "ungraded" })],
    })
    expect(mocks.apiRequest).toHaveBeenCalledWith("/lessons/lesson-1/practice/practice-1/attempts")
  })

  it("normalizes nullable reference fields without changing the three evaluations", () => {
    expect(normalizeLessonPracticeAttempt({
      id: "la-3",
      lesson_id: "lesson-1",
      section_id: "practice-1",
      answer: "free text",
      evaluation: "ungraded",
      reference_answer: null,
      feedback: "请复盘",
      elapsed_ms: 42,
      created_at: "2026-08-20T00:00:00Z",
    })).toEqual({
      id: "la-3",
      lesson_id: "lesson-1",
      section_id: "practice-1",
      answer: "free text",
      evaluation: "ungraded",
      reference_answer: "",
      feedback: "请复盘",
      elapsed_ms: 42,
      created_at: "2026-08-20T00:00:00Z",
    })
  })
})
