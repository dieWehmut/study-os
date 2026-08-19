import { beforeEach, describe, expect, it, vi } from "vitest"

import { getLesson, listLessons, normalizeLesson } from "./lessons"

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }))

vi.mock("./client", () => ({ apiRequest: mocks.apiRequest }))

describe("lessons api", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
  })

  it("lists lessons with an optional subject filter", async () => {
    mocks.apiRequest.mockResolvedValue({ items: [], count: 0 })

    await listLessons({ subject: "physics" })

    expect(mocks.apiRequest).toHaveBeenCalledWith("/lessons?subject=physics")
  })

  it("treats a backend lesson summary as the fixed ten-section template", async () => {
    mocks.apiRequest.mockResolvedValue({
      items: [{
        id: "lesson-1",
        title: "力学导论",
        subject: "physics",
        status: "draft",
        source_type: "markdown",
        source_id: "source-1",
        version: 1,
      }],
      count: 1,
    })

    const result = await listLessons()

    expect(result.items[0]).toMatchObject({
      source_type: "markdown",
      source_id: "source-1",
      sections_count: 10,
    })
  })

  it("loads one lesson by encoded id", async () => {
    mocks.apiRequest.mockResolvedValue({ id: "lesson/1", sections: [] })

    await getLesson("lesson/1")

    expect(mocks.apiRequest).toHaveBeenCalledWith("/lessons/lesson%2F1")
  })

  it("normalizes a document envelope while preserving source and section order", () => {
    const lesson = normalizeLesson({
      id: "lesson-1",
      title: "Newton's second law",
      subject: "physics",
      status: "reviewed",
      source: { id: "source-1", title: "Mechanics notes", type: "markdown" },
      document: {
        sections: [
          { id: "summary", kind: "summary", title: "Summary", body: "F = ma" },
          { id: "diagnostic", kind: "diagnostic", title: "Before you start", body: "Name the variables." },
        ],
      },
    })

    expect(lesson.source?.title).toBe("Mechanics notes")
    expect(lesson.sections.map((section) => section.kind)).toEqual(["summary", "diagnostic"])
  })
})
