import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { commitImport, previewImport, uploadImport } from "./imports"
import type { ImportInspection } from "./types"

const inspection: ImportInspection = {
  format: "csv",
  tables: [],
  selected_table: "",
  columns: ["word", "meaning"],
  sample_rows: [{ word: "abandon", meaning: "放弃" }],
  row_count: 1,
}

function mockFetchResponse(payload: unknown, status = 200) {
  return vi.spyOn(window, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  )
}

describe("import API wrappers", () => {
  beforeEach(() => {
    delete window.__STUDY_OS_API_BASE__
    delete window.go
    vi.stubEnv("VITE_API_BASE_URL", "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("uploads a file as multipart without a manual Content-Type", async () => {
    const fetchSpy = mockFetchResponse({ job_id: "job-1", inspection })
    const file = new File(["word,meaning\nabandon,放弃\n"], "words.csv", { type: "text/csv" })

    await uploadImport(file)

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe("/api/imports")
    expect(init?.method).toBe("POST")
    expect(init?.body).toBeInstanceOf(FormData)
    const headers = new Headers(init?.headers)
    expect(headers.get("Accept")).toBe("application/json")
    expect(headers.get("Content-Type")).toBeNull()
    const body = init?.body as FormData
    expect(body.get("file")).toBe(file)
    expect(body.get("table")).toBeNull()
  })

  it("appends the selected SQLite table to the upload form", async () => {
    const fetchSpy = mockFetchResponse({
      job_id: "job-2",
      inspection: { ...inspection, format: "sqlite", tables: ["words"], selected_table: "words" },
    })
    const file = new File(["sqlite-bytes"], "words.sqlite")

    await uploadImport(file, "words")

    const body = fetchSpy.mock.calls[0][1]?.body as FormData
    expect(body.get("table")).toBe("words")
  })

  it("previews with a JSON mapping body and encoded job id", async () => {
    const fetchSpy = mockFetchResponse({
      job_id: "job/1",
      state: "previewed",
      mapping: { term: "word", definition: "meaning" },
      summary: { rows: 1, insert: 1, exact_duplicate: 0, review: 0, new_sense: 0, invalid: 0 },
      rows: [],
    })

    await previewImport("job/1", { term: "word", definition: "meaning" })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe("/api/imports/job%2F1/preview")
    expect(init?.method).toBe("POST")
    expect(new Headers(init?.headers).get("Content-Type")).toContain("application/json")
    expect(JSON.parse(init?.body as string)).toEqual({
      mapping: { term: "word", definition: "meaning" },
    })
  })

  it("commits resolutions as a JSON body", async () => {
    const fetchSpy = mockFetchResponse({
      job_id: "job-1",
      state: "committed",
      summary: { inserted: 1, exact_duplicates: 0, merged: 1, pending_reviews: 0, rejected: 0, prompts_created: 3 },
    })

    await commitImport("job-1", { resolutions: { "row-2": "merge" } })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe("/api/imports/job-1/commit")
    expect(JSON.parse(init?.body as string)).toEqual({ resolutions: { "row-2": "merge" } })
  })

  it("surfaces backend errors through every wrapper", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "mapping is invalid" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await expect(previewImport("job-1", { term: "word", definition: "meaning" })).rejects.toMatchObject({
      status: 400,
      message: "mapping is invalid",
    })
  })
})
