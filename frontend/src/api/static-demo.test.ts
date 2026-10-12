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

  it("answers `scheduled` for one item the same way the list answers it", async () => {
    // The contract test above only checks that the field is *there*; a demo that always
    // answered `scheduled: false` would pass it while the panel's 取消排复习 button never
    // appeared. One fact, one definition: the detail read and the list's `scheduled_ids`
    // have to agree, both ways round.
    const list = await staticDemoRequest<{ items: Array<{ id: string }>; scheduled_ids: string[] }>("/knowledge")
    const scheduled = list.scheduled_ids[0]
    const unscheduled = list.items.map((entry) => entry.id).find((id) => !list.scheduled_ids.includes(id))
    expect(scheduled).toBeTruthy()
    expect(unscheduled).toBeTruthy()

    const queued = await staticDemoRequest<{ scheduled?: boolean }>(`/knowledge/${scheduled}`)
    expect(queued.scheduled).toBe(true)

    const notQueued = await staticDemoRequest<{ scheduled?: boolean }>(`/knowledge/${unscheduled}`)
    expect(notQueued.scheduled).toBe(false)

    // And the write→read loop closes: after 取消排复习 both answers change together. A
    // demo where the DELETE only flipped the list would leave the panel reading
    // 「已排进复习」 on the very item it just took out.
    await staticDemoRequest(`/knowledge/${scheduled}/schedule`, { method: "DELETE" })
    const afterDetail = await staticDemoRequest<{ scheduled?: boolean }>(`/knowledge/${scheduled}`)
    expect(afterDetail.scheduled).toBe(false)
    const afterList = await staticDemoRequest<{ scheduled_ids: string[] }>("/knowledge")
    expect(afterList.scheduled_ids).not.toContain(scheduled)

    // And back in again, so the loop is closed in both directions: 排进复习 has to make
    // the single read say true as well, or the panel would keep offering the button it
    // just pressed.
    await staticDemoRequest(`/knowledge/${scheduled}/schedule`, { method: "POST" })
    const backDetail = await staticDemoRequest<{ scheduled?: boolean }>(`/knowledge/${scheduled}`)
    expect(backDetail.scheduled).toBe(true)
    const backList = await staticDemoRequest<{ scheduled_ids: string[] }>("/knowledge")
    expect(backList.scheduled_ids).toContain(scheduled)

    // The chip and the state it reports have to agree: `?scheduled=yes` must contain
    // exactly the ids the same list calls scheduled, and `?scheduled=no` exactly the
    // others. A filter that disagreed with `scheduled_ids` would make the 复习状态 chip
    // and the row badges contradict each other on one screen.
    const queuedPage = await staticDemoRequest<{ items: Array<{ id: string }>; scheduled_ids: string[] }>(
      "/knowledge?scheduled=yes",
    )
    expect(queuedPage.items.map((entry) => entry.id).sort()).toEqual([...queuedPage.scheduled_ids].sort())

    const restPage = await staticDemoRequest<{ items: Array<{ id: string }>; scheduled_ids: string[] }>(
      "/knowledge?scheduled=no",
    )
    expect(restPage.items.map((entry) => entry.id)).not.toContain(scheduled)
    expect(restPage.scheduled_ids).toHaveLength(0)

    // 归档 is the third state this one fact now has to survive: hiding an item must move
    // it out of the default view AND the ?scheduled views, and asking for archived items
    // must bring it back -- without any of the other three lists changing their answer.
    await staticDemoRequest(`/knowledge/${scheduled}/archive`, { method: "POST" })
    const archivedDefault = await staticDemoRequest<{ items: Array<{ id: string }> }>("/knowledge")
    expect(archivedDefault.items.map((entry) => entry.id)).not.toContain(scheduled)
    const archivedAsked = await staticDemoRequest<{ items: Array<{ id: string }> }>("/knowledge?archived=yes")
    expect(archivedAsked.items.map((entry) => entry.id)).toContain(scheduled)
    // The single read is not filtered by 归档: a link someone already has still opens.
    const archivedDetail = await staticDemoRequest<{ id: string }>(`/knowledge/${scheduled}`)
    expect(archivedDetail.id).toBe(scheduled)
    await staticDemoRequest(`/knowledge/${scheduled}/archive`, { method: "DELETE" })
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
    // The refusal reaches the page, so it is a Chinese sentence; the route it names
    // is the bracketed detail.
    await expect(staticDemoRequest("/audio?term=hello", { method: "POST" })).rejects.toThrow(
      /展示模式没有实现这个操作（POST \/audio）/,
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

  it("answers every field the list pages read, the way the real backend does", async () => {
    // This divergence has been found five times by hand: buttons that could only fail,
    // an export that ignored the filter, filters and search the adapter skipped, a
    // daily limit that changed nothing, and derived counts that only existed off the
    // Pages build. So it is a contract now, spelled out route by route: whatever a row
    // or a screen reads, the demo has to answer it.
    const required: Array<[string, string[]]> = [
      ["/english/articles", ["items[].vocabulary_count", "items[].section_count"]],
      ["/lessons", ["items[].sections_count", "items[].filled_sections", "items[].practice_questions"]],
      // The detail route is what the editor and 环节速览 read, and it sat outside the
      // contract: a field those screens depend on could have gone missing here silently.
      ["/lessons/lesson-newton", ["id", "title", "version", "document", "sections"]],
      ["/groups", ["items[].item_count"]],
      ["/knowledge", ["items", "count", "scheduled_ids"]],
      // The chip form: 复习状态 narrowed to 「已排复习」. Same envelope as the unfiltered
      // one, and the consistency test below already walks its `scheduled_ids`.
      ["/knowledge?scheduled=yes", ["items", "count", "scheduled_ids"]],
      // 归档 widens rather than filters: the default view hides what was put away, and this
      // is the caller saying "show me those too". Same envelope; a bad value is a 400, which
      // the behaviour test above covers.
      ["/knowledge?archived=yes", ["items", "count", "scheduled_ids"]],
      // The single-item read is the only place `scheduled` is answered (the list reports
      // it through `scheduled_ids`), and the panel's 取消排复习 button hangs off it: if
      // this field went missing the button would just never appear, with nothing to say so.
      ["/knowledge/knowledge-last", ["id", "item_type", "term", "concise_definition", "scheduled"]],
      // 「所属分组」 and the word-family list come from here; an empty answer is a valid
      // answer, so the contract asks for the two keys rather than for rows inside them.
      ["/knowledge/knowledge-last/related", ["items", "groups"]],
      // 四个掌握维度 (recognition / comprehension / retrieval / use). The page renders one
      // block per dimension, so a missing `dimensions` key here is a blank panel.
      ["/knowledge/knowledge-last/mastery", ["dimensions"]],
      // 作答面: the practice attempt log. Section ids are the section type (`practice`),
      // which is what the client's practicePath() passes.
      ["/lessons/lesson-newton/practice/practice/attempts", ["items", "count"]],
      ["/mistakes", ["items", "count"]],
      // 订正状态 is a chip on the practice page, so the filtered route is what a press
      // actually asks for. Same envelope; an empty page is a valid answer.
      ["/mistakes?corrected=yes", ["items", "count"]],
      ["/reviews/due", ["items"]],
      // The same queue under a subject chip. It answers the same envelope; an empty page
      // is fine (the demo may have nothing due for that subject), but a different shape
      // would break 记忆 as soon as a chip was pressed.
      ["/reviews/due?subject=math", ["items"]],
      ["/reviews/forecast", ["days"]],
      // 答疑: the conversation list and one conversation's messages. Both answer the list
      // envelope; the messages route additionally keys on `session_id`.
      ["/chat/conversations", ["items", "count"]],
      ["/chat/messages?session_id=session-demo", ["items"]],
      ["/dashboard", ["knowledge_count", "due_count", "reviewed_today", "current_streak", "subjects_due"]],
      ["/error-causes", ["items"]],
    ]

    for (const [route, expectations] of required) {
      const body = await staticDemoRequest<Record<string, unknown>>(route)
      for (const expectation of expectations) {
        const [head, leaf] = expectation.split("[].")
        if (leaf) {
          const rows = body[head] as Array<Record<string, unknown>> | undefined
          expect(rows, `${route} -> ${head}`).toBeDefined()
          expect(rows!.length, `${route} has no rows to check`).toBeGreaterThan(0)
          // Present on the row, even when the value is 0: `undefined` is what a page
          // renders as "no label at all", which is how these went missing.
          for (const key of leaf.split(",")) {
            expect(rows![0], `${route} -> ${expectation}`).toHaveProperty(key)
          }
        } else {
          expect(body, `${route} -> ${expectation}`).toHaveProperty(expectation)
        }
      }
    }
  })

  it("gives a new record an id of its own, so 订正 marks the row it was asked about", async () => {
    // The generated ids used to restart at the fixtures' own numbers: `newID("attempt")`
    // produced "attempt-2", which a fixture already had, so correcting the new mistake
    // marked the fixture row and left the new one untouched -- two rows under one id.
    const created = await staticDemoRequest<{ attempt: { id: string } }>("/mistakes", {
      method: "POST",
      body: JSON.stringify({ subject: "math", stem: "新记的一题", cause: "method", note: "" }),
    })
    const list = await staticDemoRequest<{ items: Array<{ attempt: { id: string } }> }>("/mistakes")
    const ids = list.items.map((item) => item.attempt.id)
    expect(ids.filter((id) => id === created.attempt.id)).toHaveLength(1)
  })

  it("honours the 订正 filter the pages offer, not only the fields they read", async () => {
    // A demo that ignores ?corrected= shows an unfiltered log under a chip the reader
    // just pressed -- their press, silently discarded.
    const created = await staticDemoRequest<{ attempt: { id: string } }>("/mistakes", {
      method: "POST",
      body: JSON.stringify({ subject: "math", stem: "订正筛选演示题", cause: "method", note: "" }),
    })
    const id = created.attempt.id

    const openBefore = await staticDemoRequest<{ items: Array<{ attempt: { id: string } }> }>("/mistakes?corrected=no")
    expect(openBefore.items.map((item) => item.attempt.id)).toContain(id)

    await staticDemoRequest(`/mistakes/${id}/correct`, {
      method: "POST",
      body: JSON.stringify({ answer: "订正好了", elapsed_ms: 500 }),
    })

    const openAfter = await staticDemoRequest<{ items: Array<{ attempt: { id: string } }> }>("/mistakes?corrected=no")
    expect(openAfter.items.map((item) => item.attempt.id)).not.toContain(id)
    const fixed = await staticDemoRequest<{ items: Array<{ attempt: { id: string } }> }>("/mistakes?corrected=yes")
    expect(fixed.items.map((item) => item.attempt.id)).toContain(id)
  })

  it("carries the derived counts the pages draw from, not only the real backend", async () => {
    // Three labels were added to list rows in the app (生词 N, 已填 N/M, group counts).
    // A count that only exists on the real backend is a feature the Pages build
    // silently does not have -- the same divergence that was fixed for filters, search
    // and the daily limit.
    const articles = await staticDemoRequest<{ items: Array<{ vocabulary_count?: number; content?: { sections: Array<{ vocabulary?: unknown[] }> } }> }>("/english/articles")
    const article = articles.items[0]!
    const expected = (article.content?.sections ?? []).reduce((total, section) => total + (section.vocabulary?.length ?? 0), 0)
    expect(article.vocabulary_count).toBe(expected)
    expect(expected).toBeGreaterThan(0)

    const lessons = await staticDemoRequest<{ items: Array<{ id: string; sections_count?: number; filled_sections?: number }> }>("/lessons")
    const lesson = lessons.items[0]!
    expect(typeof lesson.filled_sections).toBe("number")
    expect(lesson.filled_sections).toBeLessThanOrEqual(lesson.sections_count ?? 0)
    expect(lesson.filled_sections).toBeGreaterThan(0)

    const groups = await staticDemoRequest<{ items: Array<{ id: string; name: string; item_count?: number }> }>("/groups")
    const group = groups.items[0]!
    expect(typeof group.item_count).toBe("number")
    // And it matches what the ?group= filter itself returns, like the real one does.
    const inGroup = await staticDemoRequest<{ items: unknown[]; count: number }>(`/knowledge?group=${encodeURIComponent(group.id)}`)
    expect(group.item_count).toBe(inGroup.items.length)
  })

  it("pages the lists the way the real endpoints do, so 加载更多 moves", async () => {
    // The app asks for a page and reads `count` for 「还有 N 条」. A demo that ignored
    // limit/offset answered every request with everything: 加载更多 appended the same
    // rows again, and the count next to it could never be right.
    const all = await staticDemoRequest<{ items: Array<{ attempt: { id: string } }>; count: number }>("/mistakes")
    expect(all.items.length).toBeGreaterThan(1)
    expect(all.count).toBe(all.items.length)

    const first = await staticDemoRequest<{ items: Array<{ attempt: { id: string } }>; count: number }>("/mistakes?limit=1")
    expect(first.items).toHaveLength(1)
    // The total is the whole filtered list, not the page.
    expect(first.count).toBe(all.count)

    const second = await staticDemoRequest<{ items: Array<{ attempt: { id: string } }> }>("/mistakes?limit=1&offset=1")
    expect(second.items).toHaveLength(1)
    expect(second.items[0]!.attempt.id).not.toBe(first.items[0]!.attempt.id)

    const articles = await staticDemoRequest<{ items: unknown[] }>("/english/articles?limit=1")
    expect(articles.items).toHaveLength(1)
  })

  it("hides an archived item from the demo list and brings it back when asked", async () => {
    // 归档 shipped in the panel; without this the demo's 归档 button threw
    // 「展示模式没有实现这个操作」. Same shape as the real one: default hides, ?archived=yes
    // widens, anything else is a bad request, and the single read keeps answering.
    const list = await staticDemoRequest<{ items: Array<{ id: string }> }>("/knowledge")
    const target = list.items[0]!.id

    const archived = await staticDemoRequest<{ status: string }>(`/knowledge/${target}/archive`, { method: "POST" })
    expect(archived.status).toBe("archived")

    const hidden = await staticDemoRequest<{ items: Array<{ id: string }> }>("/knowledge")
    expect(hidden.items.map((entry) => entry.id)).not.toContain(target)

    const asked = await staticDemoRequest<{ items: Array<{ id: string }> }>("/knowledge?archived=yes")
    expect(asked.items.map((entry) => entry.id)).toContain(target)

    // The deep link keeps working -- that is the point of 归档 rather than 删除.
    const detail = await staticDemoRequest<{ id: string }>(`/knowledge/${target}`)
    expect(detail.id).toBe(target)

    await expect(staticDemoRequest("/knowledge?archived=maybe")).rejects.toThrow()

    const restored = await staticDemoRequest<{ status: string }>(`/knowledge/${target}/archive`, { method: "DELETE" })
    expect(restored.status).toBe("unarchived")
    const back = await staticDemoRequest<{ items: Array<{ id: string }> }>("/knowledge")
    expect(back.items.map((entry) => entry.id)).toContain(target)
  })

  it("restores the demo to its fixture instead of refusing the operation", async () => {
    // 恢复备份 is wired to DELETE /backups/restore. In the demo it can honestly mean
    // "put the sample data back": without a branch the button threw
    // 「展示模式没有实现这个操作」, and a control that always fails is worse than none.
    await staticDemoRequest("/knowledge/knowledge-last/schedule", { method: "DELETE" })
    const changed = await staticDemoRequest<{ scheduled_ids: string[] }>("/knowledge")
    expect(changed.scheduled_ids).not.toContain("knowledge-last")

    const restored = await staticDemoRequest<{ status: string }>("/backups/restore", { method: "DELETE" })
    expect(restored.status).toBe("restored")

    const after = await staticDemoRequest<{ scheduled_ids: string[] }>("/knowledge")
    expect(after.scheduled_ids).toContain("knowledge-last")
  })

  it("takes a scheduled item back out of the queue, the way the real endpoint does", async () => {
    // 取消排复习 shipped before the demo learned it: the button existed and threw
    // 「展示模式没有实现这个操作」. A control that exists and fails is worse than one that
    // is not offered.
    const before = await staticDemoRequest<{ scheduled_ids: string[] }>("/knowledge")
    const scheduledID = before.scheduled_ids[0]
    expect(scheduledID).toBeTruthy()

    const removed = await staticDemoRequest<{ status: string; prompts_removed: number }>(
      `/knowledge/${scheduledID}/schedule`,
      { method: "DELETE" },
    )
    expect(removed.status).toBe("unscheduled")
    expect(removed.prompts_removed).toBe(1)

    const after = await staticDemoRequest<{ scheduled_ids: string[] }>("/knowledge")
    expect(after.scheduled_ids).not.toContain(scheduledID)

    // And the queue agrees: it is not due any more.
    const due = await staticDemoRequest<{ items: Array<{ knowledge: { id: string } }> }>("/reviews/due?limit=50")
    expect(due.items.map((entry) => entry.knowledge.id)).not.toContain(scheduledID)

    // Idempotent, like the real one: nothing left to remove is not an error.
    const again = await staticDemoRequest<{ prompts_removed: number }>(`/knowledge/${scheduledID}/schedule`, { method: "DELETE" })
    expect(again.prompts_removed).toBe(0)
  })

  it("narrows the demo mistake list by search and 错因, not just by subject", async () => {
    // A filter the demo ignores is one a visitor spends a request on and sees
    // nothing change, which reads as broken rather than as a demo limitation.
    const all = await staticDemoRequest<{ items: Array<{ attempt: { cause?: string }; question: { stem: string } }> }>("/mistakes")
    expect(all.items.length).toBeGreaterThan(1)
    const target = all.items[0]!
    const cause = target.attempt.cause ?? ""

    const byQuery = await staticDemoRequest<{ items: Array<{ question: { stem: string } }> }>(
      `/mistakes?q=${encodeURIComponent(target.question.stem.slice(0, 4))}`,
    )
    expect(byQuery.items.length).toBeGreaterThan(0)
    expect(byQuery.items.every((item) => item.question.stem.includes(target.question.stem.slice(0, 4)))).toBe(true)

    const byCause = await staticDemoRequest<{ items: Array<{ attempt: { cause?: string } }> }>(
      `/mistakes?cause=${encodeURIComponent(cause)}`,
    )
    expect(byCause.items.length).toBeGreaterThan(0)
    expect(byCause.items.every((item) => item.attempt.cause === cause)).toBe(true)

    const missed = await staticDemoRequest<{ items: unknown[] }>("/mistakes?cause=definitely-not-a-cause")
    expect(missed.items).toHaveLength(0)
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

    // The single-item read has to keep up with the queue: the 答疑 page links a
    // point by id and cannot tell from any list page whether it was scheduled.
    const detail = await staticDemoRequest<{ scheduled?: boolean }>(`/knowledge/${dumped.id}`)
    expect(detail.scheduled).toBe(true)
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

  it("saves a wiki rename in the demo instead of failing every time", async () => {
    // The mind map is editable here; a route the demo does not implement turned every
    // rename into 「改名失败」 -- a control that could only fail.
    const list = await staticDemoRequest<{ items: Array<{ id: string; detailed_markdown?: string }> }>("/knowledge?limit=1")
    const item = list.items[0]!
    const renamed = "# 新标题\n\n改写后的正文。\n"

    const saved = await staticDemoRequest<{ id: string; detailed_markdown?: string }>(`/knowledge/${item.id}/wiki`, {
      method: "PUT",
      body: JSON.stringify({ detailed_markdown: renamed }),
    })
    expect(saved.detailed_markdown).toBe(renamed)

    // And it sticks: the next read is the renamed one.
    const reread = await staticDemoRequest<{ detailed_markdown?: string }>(`/knowledge/${item.id}`)
    expect(reread.detailed_markdown).toBe(renamed)
  })

  it("grades a demo answer instead of applauding everything, and remembers the misses", async () => {
    // It used to answer "correct" to whatever it was given, which made a wrong answer
    // indistinguishable -- and left 恢复模式 with nothing to recover.
    const due = await staticDemoRequest<{ items: Array<{ prompt: { id: string; options?: string[] }; knowledge: { id: string } }> }>("/reviews/due")
    const card = due.items[0]!
    const knowledge = await staticDemoRequest<{ concise_definition?: string }>(`/knowledge/${card.knowledge.id}`)
    const expected = (knowledge.concise_definition ?? "").trim()
    expect(expected).not.toBe("")

    const wrong = await staticDemoRequest<{ outcome: string; expected_answers: string[] }>(
      `/reviews/${card.prompt.id}/answer`,
      { method: "POST", body: JSON.stringify({ answer: "definitely not the answer" }) },
    )
    expect(wrong.outcome).toBe("incorrect")
    expect(wrong.expected_answers).toEqual([expected])

    const recovery = await staticDemoRequest<{ items: Array<{ prompt: { id: string } }> }>("/reviews/due?mode=recovery")
    expect(recovery.items.map((entry) => entry.prompt.id)).toContain(card.prompt.id)

    // Getting one right does not put it in recovery, and the queue says so.
    const next = (await staticDemoRequest<{ items: Array<{ prompt: { id: string }; knowledge: { id: string } }> }>("/reviews/due")).items[0]!
    const nextKnowledge = await staticDemoRequest<{ concise_definition?: string }>(`/knowledge/${next.knowledge.id}`)
    const right = await staticDemoRequest<{ outcome: string }>(
      `/reviews/${next.prompt.id}/answer`,
      { method: "POST", body: JSON.stringify({ answer: nextKnowledge.concise_definition ?? "" }) },
    )
    expect(right.outcome).toBe("correct")
    const after = await staticDemoRequest<{ items: Array<{ prompt: { id: string } }> }>("/reviews/due?mode=recovery")
    expect(after.items.map((entry) => entry.prompt.id)).not.toContain(next.prompt.id)
  })

  it("cuts the demo review queue down to the daily limit it was asked for", async () => {
    // 每日记忆上限 is the size of today's queue, and the settings page says so: a
    // demo that answers with every due card makes that setting look inert.
    const all = await staticDemoRequest<{ items: unknown[] }>("/reviews/due")
    expect(all.items.length).toBeGreaterThan(1)

    const limited = await staticDemoRequest<{ items: unknown[] }>("/reviews/due?limit=1")
    expect(limited.items).toHaveLength(1)

    const none = await staticDemoRequest<{ items: unknown[] }>("/reviews/due?limit=0")
    expect(none.items).toHaveLength(all.items.length)
  })

  it("narrows the demo lesson list by the search box", async () => {
    // The lessons page draws 搜索课程标题; a demo that answers with the same list
    // makes the search look broken.
    const all = await staticDemoRequest<{ items: Array<{ id: string; title: string }> }>("/lessons")
    const target = all.items[0]!
    const word = target.title.slice(0, 4)

    const found = await staticDemoRequest<{ items: Array<{ title: string }>; count: number }>(
      `/lessons?q=${encodeURIComponent(word)}`,
    )
    expect(found.items.length).toBeGreaterThan(0)
    expect(found.items.every((item) => item.title.includes(word))).toBe(true)
    expect(found.count).toBe(found.items.length)

    const missed = await staticDemoRequest<{ items: unknown[]; count: number }>("/lessons?q=zzz-no-such-course")
    expect(missed.items).toHaveLength(0)
    expect(missed.count).toBe(0)
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
    // The refusal is a sentence a visitor reads on a Chinese page, so it is written
    // for them; the bracketed detail is what a developer compares against the real
    // backend.
    await expect(staticDemoRequest("/lessons", {
      method: "POST",
      body: JSON.stringify({ title: "不可写入" }),
    })).rejects.toThrow(/展示模式没有实现这个操作/)
    await expect(staticDemoRequest("/lessons/lesson-newton", {
      method: "PATCH",
      body: JSON.stringify({ version: 1, title: "不可写入" }),
    })).rejects.toThrow("GitHub Pages 展示模式没有实现这个操作（PATCH /lessons/lesson-newton）")
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
