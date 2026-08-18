import { beforeEach, describe, expect, it } from "vitest"

import { resetStaticDemoState, staticDemoRequest } from "./static-demo"

describe("static Pages API fixtures", () => {
  beforeEach(() => resetStaticDemoState())

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
    await expect(staticDemoRequest(`/mistakes/${attempt}/correct`, { method: "POST" })).resolves.toHaveProperty("corrected", true)

    const upload = await staticDemoRequest<{ job_id: string }>("/imports", { method: "POST", body: new FormData() })
    await expect(staticDemoRequest(`/imports/${upload.job_id}/preview`, { method: "POST", body: JSON.stringify({ mapping: {} }) })).resolves.toHaveProperty("summary")
    await expect(staticDemoRequest(`/imports/${upload.job_id}/commit`, { method: "POST", body: "{}" })).resolves.toHaveProperty("summary")
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
})
