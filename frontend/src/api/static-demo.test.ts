import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resetStaticDemoState, staticDemoRequest } from "./static-demo"
import { getQARecord, saveQARecord } from "./chat"

describe("static Pages API fixtures", () => {
  beforeEach(() => resetStaticDemoState())

  afterEach(() => vi.unstubAllEnvs())

  it("returns a useful dashboard without touching the network", async () => {
    const dashboard = await staticDemoRequest<{
      knowledge_count: number
      due_count: number
      recent_items: Array<{ term: string }>
    }>("/dashboard")

    expect(dashboard.knowledge_count).toBeGreaterThan(0)
    expect(dashboard.due_count).toBeGreaterThan(0)
    expect(dashboard.recent_items[0]?.term).toBeTruthy()
  })

  it("supports knowledge filtering and a local lookup", async () => {
    const page = await staticDemoRequest<{ items: Array<{ id: string; term: string }>; count: number }>(
      "/knowledge?q=last&limit=20",
    )
    expect(page.count).toBeGreaterThan(0)
    expect(page.items.some((item) => item.term.toLowerCase().includes("last"))).toBe(true)

    const lookup = await staticDemoRequest<{ source: string; item: { term: string } }>(
      "/knowledge/lookup",
      { method: "POST", body: JSON.stringify({ term: "resilient", context: "a resilient system", kind: "word" }) },
    )
    expect(lookup.source).toBe("generated")
    expect(lookup.item.term).toBe("resilient")
  })

  it("shows four independent English mastery dimensions in Pages mode", async () => {
    const projection = await staticDemoRequest<{
      knowledge_item_id: string
      subject: string
      dimensions: Array<{ dimension: string; state: string; prompt_types: string[] }>
    }>("/knowledge/knowledge-last/mastery")

    expect(projection).toMatchObject({ knowledge_item_id: "knowledge-last", subject: "english" })
    expect(projection.dimensions.map((dimension) => dimension.dimension)).toEqual([
      "recognition",
      "comprehension",
      "retrieval",
      "use",
    ])
    expect(projection.dimensions[0]).toMatchObject({ state: "untested", prompt_types: ["en_to_zh"] })
    expect(projection.dimensions.slice(1).every((dimension) => dimension.state === "missing")).toBe(true)
    await expect(staticDemoRequest("/knowledge/not-found/mastery")).rejects.toMatchObject({ status: 404 })
  })

  it("finishes a chat request in memory so polling can render an answer", async () => {
    const result = await staticDemoRequest<{ session_id: string; status: string }>("/chat", {
      method: "POST",
      body: JSON.stringify({ subject: "english", message: "Explain spaced repetition" }),
    })
    expect(result.session_id).toBeTruthy()
    expect(result.status).toBe("completed")

    const messages = await staticDemoRequest<{ items: Array<{ role: string; content: string }> }>(
      `/chat/messages?subject=english&session_id=${encodeURIComponent(result.session_id)}`,
    )
    expect(messages.items.map((message) => message.role)).toEqual(["user", "assistant"])
  })

  it("persists structured QA records in the Pages session", async () => {
    vi.stubEnv("VITE_STATIC_DEMO", "true")
    await staticDemoRequest("/chat", {
      method: "POST",
      body: JSON.stringify({ session_id: "session/qa", subject: "physics", message: "Explain force." }),
    })

    const created = await saveQARecord("session/qa", {
      subject: "physics",
      original_understanding: "Force directly creates velocity.",
      corrected_model: "Net force creates acceleration.",
      mastery_evidence: "I solved a new transfer problem.",
      unresolved: "How does drag change the model?",
      status: "open",
    })
    expect(created.id).toMatch(/^qa-/)
    expect(created.session_id).toBe("session/qa")

    const fetched = await getQARecord("session/qa")
    expect(fetched).toEqual(created)

    const updated = await saveQARecord("session/qa", {
      subject: "physics",
      original_understanding: created.original_understanding,
      corrected_model: "The vector sum of forces determines acceleration.",
      mastery_evidence: "I explained an inclined-plane example.",
      unresolved: "",
      status: "understood",
    })
    expect(updated.id).toBe(created.id)
    expect(updated.created_at).toBe(created.created_at)
    expect(updated.updated_at).not.toBe(created.updated_at)
    expect(updated.corrected_model).toContain("vector sum")

    await expect(getQARecord("missing-session")).resolves.toBeNull()
  })

  it("validates static QA record status and paired context fields", async () => {
    await staticDemoRequest("/chat", {
      method: "POST",
      body: JSON.stringify({ session_id: "session-invalid", subject: "physics", message: "Explain force." }),
    })
    await expect(staticDemoRequest("/chat/records/session-invalid", {
      method: "PUT",
      body: JSON.stringify({ subject: "physics", status: "complete" }),
    })).rejects.toMatchObject({ status: 400 })
    await expect(staticDemoRequest("/chat/records/session-invalid", {
      method: "PUT",
      body: JSON.stringify({ subject: "physics", context_type: "lesson" }),
    })).rejects.toMatchObject({ status: 400 })
  })

  it("rejects QA records for chat sessions that do not exist", async () => {
    await expect(staticDemoRequest("/chat/records/missing-session", {
      method: "PUT",
      body: JSON.stringify({ subject: "physics", status: "open" }),
    })).rejects.toMatchObject({ status: 404 })
  })

  it("rejects unsupported server-only calls instead of issuing a request", async () => {
    await expect(staticDemoRequest("/audio?term=hello", { method: "POST" })).rejects.toThrow(
      /static demo/i,
    )
  })

  it("keeps detail routes distinct from collection routes", async () => {
    const list = await staticDemoRequest<{ items: Array<{ id?: string }> }>("/english/articles?limit=100")
    const id = list.items[0]?.id
    expect(id).toBeTruthy()
    const detail = await staticDemoRequest<{ id?: string }>(`/english/articles/${id}`)
    expect(detail.id).toBe(id)
    const regenerated = await staticDemoRequest<{ id?: string }>(`/english/articles/${id}/regenerate`, { method: "POST" })
    expect(regenerated.id).toBe(id)
  })

  it("covers settings, integration, mistakes, and import preview workflows", async () => {
    const status = await staticDemoRequest<{ review: { daily_limit: number } }>("/system/status")
    expect(status.review.daily_limit).toBe(20)
    await expect(staticDemoRequest("/settings", { method: "PATCH", body: JSON.stringify({ daily_limit: 12 }) })).resolves.toMatchObject({ daily_limit: 12 })
    await expect(staticDemoRequest("/agent/vendors")).resolves.toMatchObject({ active_provider: "mock" })
    await expect(staticDemoRequest("/speech")).resolves.toHaveProperty("roles")

    const created = await staticDemoRequest<{ id: string }>("/integrate", { method: "POST", body: JSON.stringify({ subject: "english", text: "# A demo\n\nA short note." }) })
    await expect(staticDemoRequest(`/integrate/${created.id}`)).resolves.toMatchObject({ id: created.id })

    const mistakes = await staticDemoRequest<{ items: Array<{ attempt: { id: string } }> }>("/mistakes")
    const attempt = mistakes.items[0]?.attempt.id
    expect(attempt).toBeTruthy()
    await expect(staticDemoRequest(`/mistakes/${attempt}/correct`, {
      method: "POST",
      body: JSON.stringify({ answer: " 6 N ", elapsed_ms: 4200 }),
    })).resolves.toMatchObject({
      corrected: true,
      correction: { answer: "6 N", elapsed_ms: 4200, is_correct: true },
    })

    await expect(staticDemoRequest(`/mistakes/${attempt}/correct`, {
      method: "POST",
      body: JSON.stringify({ answer: "7 N", elapsed_ms: 5000 }),
    })).resolves.toMatchObject({ correction: { answer: "6 N", elapsed_ms: 4200 } })

    const upload = await staticDemoRequest<{ job_id: string }>("/imports", { method: "POST", body: new FormData() })
    await expect(staticDemoRequest(`/imports/${upload.job_id}/preview`, { method: "POST", body: JSON.stringify({ mapping: {} }) })).resolves.toHaveProperty("summary")
    await expect(staticDemoRequest(`/imports/${upload.job_id}/commit`, { method: "POST", body: "{}" })).resolves.toHaveProperty("summary")
  })

  it("rejects static mistake corrections without usable evidence", async () => {
    const mistakes = await staticDemoRequest<{ items: Array<{ attempt: { id: string } }> }>("/mistakes")
    const attempt = mistakes.items[0]?.attempt.id
    expect(attempt).toBeTruthy()

    await expect(staticDemoRequest(`/mistakes/${attempt}/correct`, {
      method: "POST",
      body: JSON.stringify({ answer: "   ", elapsed_ms: 1 }),
    })).rejects.toMatchObject({ status: 400 })
    await expect(staticDemoRequest(`/mistakes/${attempt}/correct`, {
      method: "POST",
      body: JSON.stringify({ answer: "6 N", elapsed_ms: -1 }),
    })).rejects.toMatchObject({ status: 400 })
  })

  it("schedules a corrected static mistake with only the confirmed answer", async () => {
    const created = await staticDemoRequest<{ attempt: { id: string } }>("/mistakes", {
      method: "POST",
      body: JSON.stringify({
        subject: "physics",
        stem: "F = ma，m = 2 kg、a = 3 m/s²，求合力。",
        cause: "recall",
        answer: "5 N",
        note: "先确认研究对象和正方向",
      }),
    })
    await staticDemoRequest(`/mistakes/${created.attempt.id}/correct`, {
      method: "POST",
      body: JSON.stringify({ answer: "6 N", elapsed_ms: 1200 }),
    })

    const scheduled = await staticDemoRequest<{ knowledge_id: string }>(
      `/mistakes/${created.attempt.id}/schedule`,
      { method: "POST" },
    )
    const due = await staticDemoRequest<{
      items: Array<{ prompt: { id: string; prompt_type: string }; knowledge: { id: string } }>
    }>("/reviews/due")
    const item = due.items.find((entry) => entry.knowledge.id === scheduled.knowledge_id)
    expect(item?.prompt.prompt_type).toBe("mistake_redo")

    const evaluated = await staticDemoRequest<{ expected_answers: string[] }>(
      `/reviews/${item?.prompt.id}/answer`,
      { method: "POST", body: JSON.stringify({ answer: "6 N" }) },
    )
    expect(evaluated.expected_answers).toEqual(["6 N"])
    expect(evaluated.expected_answers).not.toContain("5 N")
    expect(evaluated.expected_answers).not.toContain("先确认研究对象和正方向")
  })

  it("keeps static mistake accepted answers empty until a correction exists", async () => {
    const created = await staticDemoRequest<{ attempt: { id: string } }>("/mistakes", {
      method: "POST",
      body: JSON.stringify({
        subject: "geography",
        stem: "说明季风气候的成因。",
        cause: "recall",
        answer: "海陆热力差异不明显",
        note: "先看海陆位置和季节",
      }),
    })

    const scheduled = await staticDemoRequest<{ knowledge_id: string }>(
      `/mistakes/${created.attempt.id}/schedule`,
      { method: "POST" },
    )
    const due = await staticDemoRequest<{
      items: Array<{ prompt: { id: string }; knowledge: { id: string } }>
    }>("/reviews/due")
    const item = due.items.find((entry) => entry.knowledge.id === scheduled.knowledge_id)
    expect(item).toBeTruthy()

    const evaluated = await staticDemoRequest<{ expected_answers: string[] }>(
      `/reviews/${item?.prompt.id}/answer`,
      { method: "POST", body: JSON.stringify({ answer: "任意答案" }) },
    )
    expect(evaluated.expected_answers).toEqual([])
  })

  it("persists subject evidence on static mistake creation and updates", async () => {
    const original = {
      version: 1,
      subject: "math",
      tool: "derivation",
      data: { lines: ["2x+4=10", "2x=6"] },
    }
    const created = await staticDemoRequest<{
      attempt: { id: string; evidence?: unknown }
    }>("/mistakes", {
      method: "POST",
      body: JSON.stringify({ subject: "math", stem: "解方程", cause: "method", evidence: original }),
    })
    expect(created.attempt.evidence).toEqual(original)

    const replacement = {
      version: 1,
      subject: "math",
      tool: "derivation",
      data: { lines: ["2x+4=10", "2x=6", "x=3"] },
    }
    const updated = await staticDemoRequest<{
      attempt: { evidence?: unknown }
    }>(`/mistakes/${created.attempt.id}/evidence`, {
      method: "PATCH",
      body: JSON.stringify({ evidence: replacement }),
    })
    expect(updated.attempt.evidence).toEqual(replacement)

    const listed = await staticDemoRequest<{
      items: Array<{ attempt: { id: string; evidence?: unknown } }>
    }>("/mistakes?subject=math")
    expect(listed.items.find((item) => item.attempt.id === created.attempt.id)?.attempt.evidence).toEqual(replacement)

    const cleared = await staticDemoRequest<{ attempt: { evidence?: unknown } }>(
      `/mistakes/${created.attempt.id}/evidence`,
      { method: "PATCH", body: JSON.stringify({ evidence: {} }) },
    )
    expect(cleared.attempt.evidence).toEqual({})
  })

  it("rejects invalid static subject evidence and reports missing attempts", async () => {
    await expect(staticDemoRequest("/mistakes", {
      method: "POST",
      body: JSON.stringify({
        subject: "math",
        stem: "解方程",
        cause: "method",
        evidence: { version: 1, subject: "chemistry", tool: "equation", data: { equation: "H2" } },
      }),
    })).rejects.toMatchObject({ status: 400 })

    await expect(staticDemoRequest("/mistakes/missing-attempt/evidence", {
      method: "PATCH",
      body: JSON.stringify({
        evidence: { version: 1, subject: "math", tool: "derivation", data: { lines: ["x=1", "x=1"] } },
      }),
    })).rejects.toMatchObject({ status: 404 })

    const physics = await staticDemoRequest<{
      items: Array<{ attempt: { id: string } }>
    }>("/mistakes?subject=physics")
    await expect(staticDemoRequest(`/mistakes/${physics.items[0]?.attempt.id}/evidence`, {
      method: "PATCH",
      body: JSON.stringify({
        evidence: { version: 1, subject: "physics", tool: "free_body", data: { forces: [] } },
      }),
    })).rejects.toMatchObject({ status: 400 })
  })

  it("keeps mistake creation as strict as the backend route", async () => {
    await expect(staticDemoRequest("/mistakes", {
      method: "POST",
      body: JSON.stringify({ subject: "math", stem: " ", cause: "method" }),
    })).rejects.toMatchObject({ status: 400 })

    await expect(staticDemoRequest("/mistakes", { method: "POST" })).rejects.toMatchObject({ status: 400 })

    await expect(staticDemoRequest("/mistakes", {
      method: "POST",
      body: JSON.stringify({ subject: "math", stem: "解方程", cause: "method", extra: true }),
    })).rejects.toMatchObject({ status: 400 })

    await expect(staticDemoRequest("/mistakes", {
      method: "POST",
      body: JSON.stringify({ stem: "只写题干也能先记下" }),
    })).resolves.toMatchObject({
      question: { subject: "", stem: "只写题干也能先记下" },
      attempt: { cause: "" },
    })
  })

  it("rejects malformed evidence request bodies without clearing saved evidence", async () => {
    const evidence = {
      version: 1,
      subject: "math",
      tool: "derivation",
      data: { lines: ["x+1=2", "x=1"] },
    }
    const created = await staticDemoRequest<{
      attempt: { id: string; evidence?: unknown }
    }>("/mistakes", {
      method: "POST",
      body: JSON.stringify({ subject: "math", stem: "解方程", cause: "method", evidence }),
    })

    for (const body of ["{not json", "[]", "1", "null"]) {
      await expect(staticDemoRequest(`/mistakes/${created.attempt.id}/evidence`, {
        method: "PATCH",
        body,
      })).rejects.toMatchObject({ status: 400 })
    }
    await expect(staticDemoRequest(`/mistakes/${created.attempt.id}/evidence`, {
      method: "PATCH",
    })).rejects.toMatchObject({ status: 400 })

    const listed = await staticDemoRequest<{
      items: Array<{ attempt: { id: string; evidence?: unknown } }>
    }>("/mistakes?subject=math")
    expect(listed.items.find((item) => item.attempt.id === created.attempt.id)?.attempt.evidence).toEqual(evidence)
  })

  it("mirrors the error cause candidate, confirmation, and reclassification contract", async () => {
    const defaults = await staticDemoRequest<{
      items: Array<{ id: string; status: string }>
      count: number
    }>("/error-causes?subject=physics")
    expect(defaults.count).toBe(6)
    expect(defaults.items.every((cause) => cause.status === "confirmed")).toBe(true)

    const candidate = await staticDemoRequest<{
      id: string
      status: string
      review_fixes: boolean
    }>("/error-causes", {
      method: "POST",
      body: JSON.stringify({
        id: "physics:model-selection",
        subject: "physics",
        parent_id: "method",
        label: "模型选择错误",
        review_fixes: true,
        action: "重画受力图",
      }),
    })
    expect(candidate).toMatchObject({
      id: "physics:model-selection",
      status: "candidate",
      review_fixes: true,
    })

    const candidates = await staticDemoRequest<{ items: Array<{ id: string }>; count: number }>(
      "/error-causes?subject=physics&status=candidate",
    )
    expect(candidates.count).toBe(1)
    expect(candidates.items[0]?.id).toBe(candidate.id)

    const mistakes = await staticDemoRequest<{
      items: Array<{ question: { subject: string }; attempt: { id: string } }>
    }>("/mistakes?subject=physics")
    const attemptID = mistakes.items[0]?.attempt.id
    expect(attemptID).toBeTruthy()
    await expect(staticDemoRequest(`/mistakes/${attemptID}/cause`, {
      method: "PATCH",
      body: JSON.stringify({ cause: candidate.id }),
    })).rejects.toMatchObject({ status: 400 })

    const confirmed = await staticDemoRequest<{ status: string }>(
      `/error-causes/${encodeURIComponent(candidate.id)}`,
      { method: "PATCH", body: JSON.stringify({ status: "confirmed" }) },
    )
    expect(confirmed.status).toBe("confirmed")

    const reclassified = await staticDemoRequest<{ attempt: { cause: string } }>(
      `/mistakes/${attemptID}/cause`,
      { method: "PATCH", body: JSON.stringify({ cause: candidate.id }) },
    )
    expect(reclassified.attempt.cause).toBe(candidate.id)
    await expect(staticDemoRequest(`/mistakes/${attemptID}/schedule`, { method: "POST" })).resolves.toHaveProperty("knowledge_id")

    const geography = await staticDemoRequest<{ items: Array<{ id: string }>; count: number }>(
      "/error-causes?subject=geography",
    )
    expect(geography.count).toBe(6)
    expect(geography.items.some((cause) => cause.id === candidate.id)).toBe(false)
  })

  it("keeps dumped notes in the knowledge library and review queue", async () => {
    const dumped = await staticDemoRequest<{ id: string }>("/dump", {
      method: "POST",
      body: JSON.stringify({ text: "# A saved Pages note\n\nA definition worth reviewing." }),
    })

    const library = await staticDemoRequest<{ items: Array<{ id: string }> }>("/knowledge")
    expect(library.items.some((item) => item.id === dumped.id)).toBe(true)

    const scheduled = await staticDemoRequest<{ status: string; prompt_count: number }>(
      `/knowledge/${dumped.id}/schedule`,
      { method: "POST" },
    )
    expect(scheduled.status).toBe("scheduled")
    expect(scheduled.prompt_count).toBeGreaterThan(0)
  })

  it("persists vendor and speech settings without retaining API keys", async () => {
    const vendorSecret = "vendor-secret-pages"
    await staticDemoRequest("/agent/config", {
      method: "PATCH",
      body: JSON.stringify({ provider: "deepseek", api_key: vendorSecret, model: "custom-chat", reasoning_model: "custom-reasoner" }),
    })
    const vendors = await staticDemoRequest<{ items: Array<{ id: string; key_configured?: boolean; models?: string[] }> }>("/agent/vendors")
    const deepseek = vendors.items.find((vendor) => vendor.id === "deepseek")
    expect(deepseek?.key_configured).toBe(true)
    expect(deepseek?.models).toEqual(expect.arrayContaining(["custom-chat", "custom-reasoner"]))
    expect(JSON.stringify(vendors)).not.toContain(vendorSecret)

    const speechSecret = "speech-secret-pages"
    await staticDemoRequest("/speech/config", {
      method: "PATCH",
      body: JSON.stringify({ api_key: speechSecret, provider: "browser", model: "demo-voice" }),
    })
    const speech = await staticDemoRequest<{ speech: { key_configured?: boolean; api_key?: string; model?: string } }>("/speech")
    expect(speech.speech.key_configured).toBe(true)
    expect(speech.speech.model).toBe("demo-voice")
    expect(speech.speech.api_key).toBeUndefined()
    expect(JSON.stringify(speech)).not.toContain(speechSecret)
  })

  it("uses supported review prompt types and readable expected answers", async () => {
    const due = await staticDemoRequest<{ items: Array<{ prompt: { id: string; prompt_type: string; options?: string[] }; knowledge: { id: string } }> }>("/reviews/due")
    expect(due.items.map((item) => item.prompt.prompt_type)).toEqual(expect.arrayContaining(["en_to_zh", "context_cloze"]))

    const prompt = due.items[0]
    expect(prompt).toBeTruthy()
    const evaluation = await staticDemoRequest<{ expected_answers: string[] }>(`/reviews/${prompt!.prompt.id}/answer`, {
      method: "POST",
      body: JSON.stringify({ answer: prompt!.prompt.options?.[0] ?? "definition" }),
    })
    expect(evaluation.expected_answers.length).toBeGreaterThan(0)
    expect(evaluation.expected_answers).not.toContain(prompt!.knowledge.id)
  })

  it("commits an imported row into the in-memory knowledge library", async () => {
    const upload = await staticDemoRequest<{ job_id: string }>("/imports", { method: "POST", body: new FormData() })
    await staticDemoRequest(`/imports/${upload.job_id}/preview`, {
      method: "POST",
      body: JSON.stringify({ mapping: { term: "term", definition: "definition" } }),
    })
    await staticDemoRequest(`/imports/${upload.job_id}/commit`, { method: "POST", body: "{}" })
    const library = await staticDemoRequest<{ items: Array<{ term: string }> }>("/knowledge?q=resilient")
    expect(library.items.some((item) => item.term === "resilient")).toBe(true)
  })

  it("filters forecast counts and knowledge groups by their requested scope", async () => {
    const forecast = await staticDemoRequest<{ days: Array<{ count: number }> }>("/reviews/forecast?days=1&subject=physics")
    expect(forecast.days[0]?.count).toBe(1)

    const grouped = await staticDemoRequest<{ items: Array<{ subject?: string }> }>("/knowledge?group=english-core")
    expect(grouped.items.length).toBeGreaterThan(0)
    expect(grouped.items.every((item) => item.subject === "english")).toBe(true)
  })

  it("provides the fixed ten-section lesson preview fixture", async () => {
    const list = await staticDemoRequest<{ items: Array<{ id: string; sections_count?: number }> }>("/lessons")
    const lessonID = list.items[0]?.id
    expect(lessonID).toBeTruthy()
    expect(list.items[0]?.sections_count).toBe(10)

    const detail = await staticDemoRequest<{ sections: Array<{ type: string; required?: boolean }> }>(`/lessons/${lessonID}`)
    expect(detail.sections).toHaveLength(10)
    expect(detail.sections.every((section) => section.required === true)).toBe(true)
    expect(detail.sections.map((section) => section.type)).toEqual([
      "diagnostic",
      "objectives",
      "concept",
      "examples",
      "visualization",
      "practice",
      "feedback",
      "summary",
      "memory",
      "follow_up",
    ])
  })

  it("includes a graded answer and explanation in the static practice fixture", async () => {
    const detail = await staticDemoRequest<{
      sections: Array<{ type: string; content?: unknown }>
    }>("/lessons/lesson-newton")
    const practice = detail.sections.find((section) => section.type === "practice")
    expect(practice?.content).toMatchObject({
      question: "若 m = 4 kg、a = 2 m/s²，F 是多少？",
      options: ["2 N", "6 N", "8 N"],
      correct_answer: "8 N",
      explanation: expect.stringContaining("F = ma"),
    })
  })

  it("keeps lesson writes backend-only in the static Pages adapter", async () => {
    await expect(staticDemoRequest("/lessons", {
      method: "POST",
      body: JSON.stringify({ title: "不可写入" }),
    })).rejects.toThrow(/static demo does not implement/i)
    await expect(staticDemoRequest("/lessons/lesson-newton", {
      method: "PATCH",
      body: JSON.stringify({ version: 1, title: "不可写入" }),
    })).rejects.toThrow(/static demo does not implement/i)
  })

  it("rejects unknown lesson statuses like the backend route", async () => {
    await expect(staticDemoRequest("/lessons?status=not-a-status")).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/invalid lesson status/i),
    })
  })

  it("records a trimmed, case-insensitive correct lesson answer", async () => {
    const attempt = await staticDemoRequest<{
      id: string
      lesson_id: string
      section_id: string
      answer: string
      evaluation: string
      reference_answer: string
      feedback: string
      elapsed_ms: number
      created_at: string
    }>("/lessons/lesson-newton/practice/practice/attempts", {
      method: "POST",
      body: JSON.stringify({ answer: " 8 n ", elapsed_ms: 123 }),
    })

    expect(attempt).toMatchObject({
      lesson_id: "lesson-newton",
      section_id: "practice",
      answer: "8 n",
      evaluation: "correct",
      reference_answer: "8 N",
      elapsed_ms: 123,
    })
    expect(attempt.id).toBeTruthy()
    expect(attempt.created_at).toBeTruthy()

    const history = await staticDemoRequest<{ items: typeof attempt[]; count: number }>(
      "/lessons/lesson-newton/practice/practice/attempts",
    )
    expect(history.count).toBe(1)
    expect(history.items[0]).toEqual(attempt)
  })

  it("records an incorrect lesson answer with the reference and feedback", async () => {
    const attempt = await staticDemoRequest<{ evaluation: string; reference_answer: string; feedback: string }>(
      "/lessons/lesson-newton/practice/practice/attempts",
      { method: "POST", body: JSON.stringify({ answer: "2 N", elapsed_ms: 0 }) },
    )

    expect(attempt).toMatchObject({
      evaluation: "incorrect",
      reference_answer: "8 N",
    })
    expect(attempt.feedback).toBeTruthy()
  })

  it("lists the newest lesson attempt first even with deterministic demo timestamps", async () => {
    const route = "/lessons/lesson-newton/practice/practice/attempts"
    const first = await staticDemoRequest<{ id: string }>(route, {
      method: "POST",
      body: JSON.stringify({ answer: "2 N", elapsed_ms: 10 }),
    })
    const second = await staticDemoRequest<{ id: string }>(route, {
      method: "POST",
      body: JSON.stringify({ answer: "8 N", elapsed_ms: 20 }),
    })

    const history = await staticDemoRequest<{ items: Array<{ id: string }>; count: number }>(route)

    expect(history.count).toBe(2)
    expect(history.items.map((item) => item.id)).toEqual([second.id, first.id])
  })

  it("keeps an answer without a key as an ungraded lesson attempt", async () => {
    const attempt = await staticDemoRequest<{ evaluation: string; reference_answer: string; feedback: string }>(
      "/lessons/lesson-newton/practice/memory/attempts",
      { method: "POST", body: JSON.stringify({ answer: "我会先画受力图", elapsed_ms: 45 }) },
    )

    expect(attempt.evaluation).toBe("ungraded")
    expect(attempt.reference_answer).toBe("")
    expect(attempt.feedback).toMatch(/复盘|反馈/)
  })

  it("rejects empty answers, negative elapsed time, and unknown lesson sections", async () => {
    const route = "/lessons/lesson-newton/practice/practice/attempts"
    await expect(staticDemoRequest(route, {
      method: "POST",
      body: JSON.stringify({ answer: "   ", elapsed_ms: 10 }),
    })).rejects.toMatchObject({ status: 400 })
    await expect(staticDemoRequest(route, {
      method: "POST",
      body: JSON.stringify({ answer: "8 N", elapsed_ms: -1 }),
    })).rejects.toMatchObject({ status: 400 })
    await expect(staticDemoRequest(route, {
      method: "POST",
      body: JSON.stringify({ answer: "8 N", elapsed_ms: 1.5 }),
    })).rejects.toMatchObject({ status: 400 })
    await expect(staticDemoRequest("/lessons/missing/practice/practice/attempts", {
      method: "POST",
      body: JSON.stringify({ answer: "8 N", elapsed_ms: 10 }),
    })).rejects.toMatchObject({ status: 404 })
    await expect(staticDemoRequest("/lessons/lesson-newton/practice/missing/attempts", {
      method: "POST",
      body: JSON.stringify({ answer: "8 N", elapsed_ms: 10 }),
    })).rejects.toMatchObject({ status: 404 })
  })
})
