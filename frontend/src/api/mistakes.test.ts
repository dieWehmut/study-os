import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  correctMistake,
  deleteMistake,
  listMistakes,
  reclassifyMistake,
  recordMistake,
  scheduleMistake,
} from "./mistakes"

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

describe("mistakes API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("flattens the server's question/attempt pair into one row the page can draw", async () => {
    // The store keeps them apart on purpose -- the same question gets attempted
    // again after 订正. The page has no use for that split yet, and every
    // component downstream already speaks MistakeRecord.
    mocks.apiRequest.mockResolvedValue({
      count: 1,
      items: [
        {
          question: { id: "q-1", subject: "physics", stem: "受力分析", created_at: "2026-08-08T09:00:00Z" },
          attempt: { id: "qa-1", question_id: "q-1", cause: "method", note: "少了摩擦力", occurred_at: "2026-08-08T09:00:00Z" },
        },
      ],
    })

    const records = await listMistakes({ subject: "physics" })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/mistakes?subject=physics")
    expect(records).toEqual([
      {
        id: "qa-1",
        subject: "physics",
        question: "受力分析",
        cause: "method",
        note: "少了摩擦力",
        createdAt: "2026-08-08T09:00:00Z",
      },
    ])
  })

  it("preserves a free-text cause until it can be reclassified", async () => {
    mocks.apiRequest.mockResolvedValue({
      count: 2,
      items: [
        {
          question: { id: "q-1", subject: "math", stem: "解方程", created_at: "2026-08-08T09:00:00Z" },
          attempt: { id: "qa-1", question_id: "q-1", cause: "typo-that-never-existed", occurred_at: "2026-08-08T09:00:00Z" },
        },
        {
          question: { id: "q-2", subject: "math", stem: "求导", created_at: "2026-08-08T09:01:00Z" },
          attempt: { id: "qa-2", question_id: "q-2", cause: "careless", occurred_at: "2026-08-08T09:01:00Z" },
        },
      ],
    })

    const records = await listMistakes()

    expect(mocks.apiRequest).toHaveBeenCalledWith("/mistakes")
    expect(records.map((record) => record.id)).toEqual(["qa-1", "qa-2"])
    expect(records[0].cause).toBe("typo-that-never-existed")
  })

  it("files a mistake and hands back the row that was written", async () => {
    mocks.apiRequest.mockResolvedValue({
      question: { id: "q-9", subject: "geography", stem: "城市化对水循环的影响", created_at: "2026-08-09T02:00:00Z" },
      attempt: { id: "qa-9", question_id: "q-9", cause: "recall", note: "", occurred_at: "2026-08-09T02:00:00Z" },
    })

    const filed = await recordMistake({ subject: "geography", question: "城市化对水循环的影响", cause: "recall" })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/mistakes", {
      method: "POST",
      body: JSON.stringify({ subject: "geography", stem: "城市化对水循环的影响", cause: "recall", note: "" }),
    })
    expect(filed.id).toBe("qa-9")
    expect(filed.note).toBeUndefined()
  })

  it("deletes by the attempt id, because that is what a row on the page is", async () => {
    mocks.apiRequest.mockResolvedValue(undefined)

    await deleteMistake("qa-1")

    expect(mocks.apiRequest).toHaveBeenCalledWith("/mistakes/qa-1", { method: "DELETE" })
  })

  it("carries the link that says a row is already in the review queue", async () => {
    // The page has to stop offering 排进复习 on a row it already scheduled, and
    // it only ever sees the list. A link the row does not carry is one the page
    // cannot act on.
    mocks.apiRequest.mockResolvedValue({
      count: 1,
      items: [
        {
          question: {
            id: "q-1",
            subject: "physics",
            stem: "受力分析",
            knowledge_item_id: "k-mistake-1",
            created_at: "2026-08-08T09:00:00Z",
          },
          attempt: { id: "qa-1", question_id: "q-1", cause: "recall", occurred_at: "2026-08-08T09:00:00Z" },
        },
      ],
    })

    const records = await listMistakes()

    expect(records[0].knowledgeItemId).toBe("k-mistake-1")
  })

  it("leaves the link off a row nothing has scheduled", async () => {
    // An absent field must read as "not queued". Reading it as queued would
    // lock the button on every row against a backend that predates the link.
    mocks.apiRequest.mockResolvedValue({
      count: 1,
      items: [
        {
          question: { id: "q-1", subject: "physics", stem: "受力分析", created_at: "2026-08-08T09:00:00Z" },
          attempt: { id: "qa-1", question_id: "q-1", cause: "recall", occurred_at: "2026-08-08T09:00:00Z" },
        },
      ],
    })

    const records = await listMistakes()

    expect(records[0].knowledgeItemId).toBeUndefined()
  })

  it("schedules by the attempt id and hands back the item it became", async () => {
    mocks.apiRequest.mockResolvedValue({
      status: "scheduled",
      knowledge_id: "k-mistake-1",
      prompt_count: 1,
    })

    const knowledgeId = await scheduleMistake("qa-1")

    expect(mocks.apiRequest).toHaveBeenCalledWith("/mistakes/qa-1/schedule", { method: "POST" })
    expect(knowledgeId).toBe("k-mistake-1")
  })

  it("reclassifies by attempt id and URL-encodes the stable cause id", async () => {
    mocks.apiRequest.mockResolvedValue({
      question: { id: "q-1", subject: "physics", stem: "受力分析", created_at: "2026-08-08T09:00:00Z" },
      attempt: { id: "qa-1", question_id: "q-1", cause: "physics:model-selection", occurred_at: "2026-08-08T09:00:00Z" },
    })

    const reclassified = await reclassifyMistake("qa-1", "physics:model-selection")

    expect(mocks.apiRequest).toHaveBeenCalledWith("/mistakes/qa-1/cause", {
      method: "PATCH",
      body: JSON.stringify({ cause: "physics:model-selection" }),
    })
    expect(reclassified.cause).toBe("physics:model-selection")
  })

  it("carries the mark that says a row has been put right", async () => {
    // The page has to stop offering 订正 on a row already fixed, and it only
    // ever sees the list. Server-derived, so a reload agrees with the press.
    mocks.apiRequest.mockResolvedValue({
      count: 1,
      items: [
        {
          question: { id: "q-1", subject: "physics", stem: "受力分析", created_at: "2026-08-08T09:00:00Z" },
          attempt: { id: "qa-1", question_id: "q-1", cause: "method", occurred_at: "2026-08-08T09:00:00Z" },
          corrected: true,
        },
      ],
    })

    const records = await listMistakes()

    expect(records[0].corrected).toBe(true)
  })

  it("leaves the mark off a row nothing has put right", async () => {
    // An absent field reads as "not fixed". The other way round would hide the
    // button on every row against a backend that predates the field.
    mocks.apiRequest.mockResolvedValue({
      count: 1,
      items: [
        {
          question: { id: "q-1", subject: "physics", stem: "受力分析", created_at: "2026-08-08T09:00:00Z" },
          attempt: { id: "qa-1", question_id: "q-1", cause: "method", occurred_at: "2026-08-08T09:00:00Z" },
        },
      ],
    })

    const records = await listMistakes()

    expect(records[0].corrected).toBeUndefined()
  })

  it("corrects by the attempt id and hands back the row, still a mistake", async () => {
    // 订正 is not 删除: the row stays, because "I got this wrong once and fixed
    // it" is the sentence the log exists to be able to say.
    mocks.apiRequest.mockResolvedValue({
      question: { id: "q-1", subject: "physics", stem: "受力分析", created_at: "2026-08-08T09:00:00Z" },
      attempt: { id: "qa-1", question_id: "q-1", cause: "method", occurred_at: "2026-08-08T09:00:00Z" },
      corrected: true,
      correction: { id: "qa-correction-1", answer: "6 N", elapsed_ms: 4200, is_correct: true, occurred_at: "2026-08-08T09:01:00Z" },
    })

    const fixed = await correctMistake("qa-1", { answer: "6 N", elapsedMs: 4200 })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/mistakes/qa-1/correct", {
      method: "POST",
      body: JSON.stringify({ answer: "6 N", elapsed_ms: 4200 }),
    })
    expect(fixed.id).toBe("qa-1")
    expect(fixed.cause).toBe("method")
    expect(fixed.corrected).toBe(true)
    expect(fixed.correction).toEqual({ answer: "6 N", elapsedMs: 4200, occurredAt: "2026-08-08T09:01:00Z" })
  })

  it("projects correction evidence from list responses", async () => {
    mocks.apiRequest.mockResolvedValue({
      count: 1,
      items: [{
        question: { id: "q-1", subject: "physics", stem: "F = ma", created_at: "2026-08-08T09:00:00Z" },
        attempt: { id: "qa-1", question_id: "q-1", cause: "method", occurred_at: "2026-08-08T09:00:00Z" },
        correction: { id: "qa-correction-1", question_id: "q-1", answer: "6 N", elapsed_ms: 4200, is_correct: true, occurred_at: "2026-08-08T09:01:00Z" },
      }],
    })

    const records = await listMistakes()

    expect(records[0].corrected).toBe(true)
    expect(records[0].correction).toEqual({ answer: "6 N", elapsedMs: 4200, occurredAt: "2026-08-08T09:01:00Z" })
  })
})
