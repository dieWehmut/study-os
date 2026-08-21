import type { EnglishArticle, EnglishArticleContent } from "./english-articles"
import type { IntegratedNote } from "./integrate"
import type { LessonPracticeAttempt, LessonPracticeEvaluation } from "./lesson-practice"
import type { Lesson } from "./lessons"
import type { KnowledgeGroup, KnowledgeListResponse } from "./knowledge"
import type { ChatMessage, DashboardData, DueReview, KnowledgeItem, ReviewEvaluation } from "./types"
import { normalizeSubjectAttemptEvidence, type MistakeEvidence } from "@/lib/mistake-evidence"

const DEMO_NOW = "2026-08-18T09:00:00.000Z"

interface StaticMistakePair {
  question: {
    id: string
    subject: string
    stem: string
    knowledge_item_id?: string
    created_at: string
  }
  attempt: {
    id: string
    question_id: string
    cause: string
    note?: string
    evidence?: MistakeEvidence
    answer?: string
    elapsed_ms?: number
    is_correct?: boolean
    occurred_at: string
  }
  correction?: {
    id: string
    question_id: string
    answer: string
    elapsed_ms: number
    is_correct: boolean
    occurred_at: string
  }
  corrected?: boolean
}

interface StaticErrorCause {
  id: string
  subject: string
  parent_id?: string
  label: string
  review_fixes: boolean
  action: string
  status: "candidate" | "confirmed" | "archived"
  source_type?: string
  source_id?: string
  sort_order: number
  created_at: string
  updated_at: string
}

type StaticQARecordStatus = "open" | "understood" | "follow_up"
type StaticQARecordContextType = "knowledge_item" | "question" | "lesson"

interface StaticQARecord {
  id: string
  session_id: string
  subject: string
  context_type?: StaticQARecordContextType
  context_id?: string
  original_understanding: string
  corrected_model: string
  mastery_evidence: string
  unresolved: string
  status: StaticQARecordStatus
  created_at: string
  updated_at: string
}

interface StaticImportJob {
  jobId: string
  previewed: boolean
  committed: boolean
}

interface StaticState {
  sequence: number
  knowledge: KnowledgeItem[]
  scheduled: Set<string>
  groups: KnowledgeGroup[]
  due: DueReview[]
  messages: ChatMessage[]
  qaRecords: Map<string, StaticQARecord>
  notes: IntegratedNote[]
  lessons: Lesson[]
  lessonAttempts: LessonPracticeAttempt[]
  articles: EnglishArticle[]
  mistakes: StaticMistakePair[]
  errorCauses: StaticErrorCause[]
  vendors: Array<Record<string, unknown>>
  activeProvider: string
  speech: Record<string, unknown>
  roles: Array<Record<string, unknown>>
  activeRoleId: string
  dailyLimit: number
  backups: Array<Record<string, unknown>>
  imports: Map<string, StaticImportJob>
}

function makeKnowledge(): KnowledgeItem[] {
  return [
    {
      id: "knowledge-last",
      item_type: "word_wiki",
      term: "last",
      part_of_speech: "verb / adjective",
      pronunciation: "/laest/",
      concise_definition: "to continue; the final one in a series",
      detailed_markdown: "## last\n\nTo continue for a period of time. It can also describe the final item in a sequence.\n\n- The batteries last all day.\n- This is the last chapter.",
      example: "The lesson should last forty minutes.",
      level: "B1",
      subject: "english",
      tags: ["core", "english-core", "duration"],
    },
    {
      id: "knowledge-spaced-repetition",
      item_type: "expression_wiki",
      term: "spaced repetition",
      part_of_speech: "noun phrase",
      concise_definition: "reviewing information at increasing intervals",
      detailed_markdown: "## spaced repetition\n\nA review method that brings an item back shortly before it is likely to be forgotten.",
      example: "Spaced repetition turns short reviews into durable memory.",
      level: "B2",
      subject: "english",
      tags: ["core", "english-core", "memory"],
    },
    {
      id: "knowledge-newton",
      item_type: "concept_wiki",
      term: "Newton's second law",
      concise_definition: "net force equals mass times acceleration",
      detailed_markdown: "## Newton's second law\n\nThe vector relation is **F = ma**. Keep the sign convention consistent before substituting values.",
      example: "A 2 kg mass with 3 m/s² acceleration has a net force of 6 N.",
      level: "high-school",
      subject: "physics",
      tags: ["mechanics", "formula"],
    },
    {
      id: "knowledge-equilibrium",
      item_type: "concept_wiki",
      term: "chemical equilibrium",
      concise_definition: "forward and reverse reaction rates are equal",
      detailed_markdown: "## chemical equilibrium\n\nEquilibrium is dynamic: both directions continue, but concentrations stay steady.",
      example: "Adding a reactant shifts the system toward products.",
      level: "high-school",
      subject: "chemistry",
      tags: ["reactions"],
    },
  ]
}

function makeDue(knowledge: KnowledgeItem, index: number): DueReview {
  const recognition = index % 2 === 0
  return {
    prompt: {
      id: `prompt-${knowledge.id}`,
      knowledge_item_id: knowledge.id,
      prompt_type: recognition ? "en_to_zh" : "context_cloze",
      question: index % 2 === 0
        ? `What does “${knowledge.term}” mean?`
        : `Use “${knowledge.term}” in a sentence.`,
      options: recognition ? undefined : [knowledge.concise_definition, "a kind of container", "a location"],
    },
    knowledge: {
      id: knowledge.id,
      item_type: knowledge.item_type,
      part_of_speech: knowledge.part_of_speech,
      pronunciation: knowledge.pronunciation,
      level: knowledge.level,
      tags: knowledge.tags,
    },
    due_at: DEMO_NOW,
  }
}

function makeArticle(): EnglishArticle {
  const content: EnglishArticleContent = {
    title: "How Small Reviews Become Strong Memory",
    metadata: {
      original_title: "How Small Reviews Become Strong Memory",
      author: "Study OS editorial",
      source_name: "Static demo article",
      published_at: "2026-08-01",
    },
    sections: [
      {
        title: "A better interval",
        paragraphs: [
          {
            segments: [
              { text: "Memory improves when a learner retrieves an idea just before it fades. " },
              { text: "Spacing", emphasized: true },
              { text: " creates room for forgetting and recovery." },
            ],
            translation: "当学习者在记忆即将淡去前重新提取时，记忆会变得更牢固。间隔为遗忘和恢复留下空间。",
          },
        ],
        vocabulary: [
          { term: "retrieve", part_of_speech: "verb", definition: "to bring information back to mind", usage: "retrieve an idea" },
          { term: "fade", part_of_speech: "verb", definition: "to become less clear or strong", usage: "memories fade" },
        ],
      },
      {
        title: "Feedback, not punishment",
        paragraphs: [
          {
            segments: [{ text: "A wrong answer is a signal. It tells the next review what deserves attention." }],
            translation: "错误答案是一种信号，它告诉下一次复习应该关注什么。",
          },
        ],
      },
    ],
  }
  return {
    id: "article-memory",
    title: content.title,
    original_title: content.metadata.original_title,
    author: content.metadata.author,
    source_name: content.metadata.source_name,
    published_at: content.metadata.published_at,
    original_text: "Memory improves when a learner retrieves an idea just before it fades.",
    content,
    section_count: content.sections.length,
    provider: "mock",
    model: "static-demo",
    created_at: DEMO_NOW,
    updated_at: DEMO_NOW,
  }
}

function makeNote(): IntegratedNote {
  return {
    id: "integrate-memory",
    subject: "english",
    title: "Spaced repetition at a glance",
    source_type: "demo",
    mindmap: {
      title: "Spaced repetition at a glance",
      nodes: [
        { id: "root", label: "Spaced repetition", node_type: "root", note: "Retrieve before forgetting." },
        { id: "interval", label: "Increasing intervals", parent_id: "root", node_type: "section" },
        { id: "feedback", label: "Use feedback", parent_id: "root", node_type: "section" },
      ],
    },
    cards: [
      { id: "card-1", card_type: "conclusion", title: "Core idea", body: "Review just before recall becomes difficult.", tags: ["memory"] },
      { id: "card-2", card_type: "strategy", title: "Next action", body: "Keep the next review short and specific.", tags: ["practice"] },
    ],
    created_at: DEMO_NOW,
  }
}

function makeLesson(): Lesson {
  const sections = [
    { id: "diagnostic", type: "diagnostic", title: "开始前", position: 0, required: true, content: "先说说：力、质量和加速度之间可能有什么关系？" },
    { id: "objectives", type: "objectives", title: "学习目标", position: 1, required: true, content: ["识别公式中的变量", "用统一单位建立 F = ma"] },
    { id: "concept", type: "concept", title: "核心概念", position: 2, required: true, content: "合力等于质量乘以加速度：F = ma。先画出方向，再代入数值。" },
    { id: "examples", type: "examples", title: "一个例子", position: 3, required: true, content: "2 kg 物体以 3 m/s² 加速时，合力为 6 N。" },
    { id: "visualization", type: "visualization", title: "图示与结构", position: 4, required: true, content: "先画出受力方向，再把每个方向的力放进同一个坐标约定。" },
    {
      id: "practice",
      type: "practice",
      title: "马上练一题",
      position: 5,
      required: true,
      content: {
        question: "若 m = 4 kg、a = 2 m/s²，F 是多少？",
        options: ["2 N", "6 N", "8 N"],
        correct_answer: "8 N",
        explanation: "F = ma，所以 F = 4 × 2 = 8 N；先保持单位一致，再检查方向。",
      },
    },
    { id: "feedback", type: "feedback", title: "反馈与纠正", position: 6, required: true, content: "如果答案不是 8 N，先检查单位和方向，再重新代入。" },
    { id: "summary", type: "summary", title: "一句话总结", position: 7, required: true, content: "方向先于数字；单位一致后再使用 F = ma。" },
    { id: "memory", type: "memory", title: "记忆确认", position: 8, required: true, content: "合上页面，用自己的话说出公式和一个使用条件。" },
    { id: "follow-up", type: "follow_up", title: "下一步", position: 9, required: true, content: "去练习区记录一个仍然含糊的受力图。" },
  ]
  return {
    id: "lesson-newton",
    title: "牛顿第二定律：从受力图开始",
    subject: "physics",
    status: "published",
    source_type: "knowledge",
    source_id: "knowledge-newton",
    source: { id: "knowledge-newton", title: "Newton's second law", type: "knowledge" },
    document: { schema_version: 1, sections },
    sections,
    objectives: ["先看懂关系，再开始计算"],
    estimated_minutes: 15,
    sections_count: sections.length,
    version: 1,
    created_at: DEMO_NOW,
    updated_at: DEMO_NOW,
  }
}

function makeErrorCauses(): StaticErrorCause[] {
  return [
    { id: "recall", subject: "", label: "想不起来", review_fixes: true, action: "回到记忆检测，让它排进复习队列", status: "confirmed", sort_order: 0, created_at: DEMO_NOW, updated_at: DEMO_NOW },
    { id: "misread", subject: "", label: "看错题", review_fixes: false, action: "读题时先圈出条件和问的是什么，再动笔", status: "confirmed", sort_order: 1, created_at: DEMO_NOW, updated_at: DEMO_NOW },
    { id: "careless", subject: "", label: "算错 / 手滑", review_fixes: false, action: "留出检查这一步的时间，别靠再记一遍", status: "confirmed", sort_order: 2, created_at: DEMO_NOW, updated_at: DEMO_NOW },
    { id: "method", subject: "", label: "思路不对", review_fixes: false, action: "补的是方法，不是这道题：找同类题再做两道", status: "confirmed", sort_order: 3, created_at: DEMO_NOW, updated_at: DEMO_NOW },
    { id: "time", subject: "", label: "没时间做", review_fixes: false, action: "问题在配速，不在这道题本身", status: "confirmed", sort_order: 4, created_at: DEMO_NOW, updated_at: DEMO_NOW },
    { id: "unknown", subject: "", label: "还没想清楚", review_fixes: false, action: "先记下来，等想清楚再归类", status: "confirmed", sort_order: 5, created_at: DEMO_NOW, updated_at: DEMO_NOW },
  ]
}

function makeInitialState(): StaticState {
  const knowledge = makeKnowledge()
  const messages: ChatMessage[] = [
    {
      id: "chat-demo-user",
      session_id: "session-demo",
      subject: "english",
      role: "user",
      content: "What is spaced repetition?",
      status: "done",
      created_at: DEMO_NOW,
    },
    {
      id: "chat-demo-ai",
      session_id: "session-demo",
      subject: "english",
      role: "assistant",
      content: "It is a review method that brings an item back at increasing intervals, using each retrieval as feedback.",
      status: "done",
      created_at: DEMO_NOW,
    },
  ]
  const mistakes: StaticMistakePair[] = [
    {
      question: { id: "question-1", subject: "english", stem: "I forgot the difference between last and latest.", knowledge_item_id: "knowledge-last", created_at: DEMO_NOW },
      attempt: { id: "attempt-1", question_id: "question-1", cause: "recall", occurred_at: DEMO_NOW },
    },
    {
      question: { id: "question-2", subject: "physics", stem: "I used the wrong sign in F = ma.", created_at: DEMO_NOW },
      attempt: { id: "attempt-2", question_id: "question-2", cause: "careless", occurred_at: DEMO_NOW },
    },
  ]
  return {
    sequence: 1,
    knowledge,
    scheduled: new Set(["knowledge-last", "knowledge-spaced-repetition"]),
    groups: [
      { id: "english-core", name: "English core", kind: "tag" },
      { id: "memory", name: "Memory", kind: "tag" },
      { id: "mechanics", name: "Mechanics", kind: "tag" },
    ],
    due: [makeDue(knowledge[0], 0), makeDue(knowledge[1], 1), makeDue(knowledge[2], 2)],
    messages,
    qaRecords: new Map(),
    notes: [makeNote()],
    lessons: [makeLesson()],
    lessonAttempts: [],
    articles: [makeArticle()],
    mistakes,
    errorCauses: makeErrorCauses(),
    vendors: [
      { id: "mock", display_name: "Local demo", implemented: true, key_configured: false, models: ["static-demo"], active: true, base_url: "" },
      { id: "deepseek", display_name: "DeepSeek", implemented: true, key_configured: false, models: ["deepseek-chat", "deepseek-reasoner"], active: false, base_url: "https://api.deepseek.com/v1" },
      { id: "qwen", display_name: "Qwen", implemented: false, key_configured: false, models: ["qwen-plus"], active: false, base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    ],
    activeProvider: "mock",
    speech: {
      provider: "browser",
      base_url: "",
      model: "browser-speech",
      voice: "default",
      format: "mp3",
      key_configured: false,
      configured: true,
      providers: [{ id: "browser", display_name: "Browser speech", local: true, model: "browser-speech", voice: "default" }],
    },
    roles: [
      { id: "role-default", name: "Default", bio: "A clear, neutral reading voice.", has_avatar: false, provider: "browser", model: "browser-speech", voice: "default", sort_order: 0, created_at: DEMO_NOW, updated_at: DEMO_NOW },
    ],
    activeRoleId: "role-default",
    dailyLimit: 20,
    backups: [],
    imports: new Map(),
  }
}

let state = makeInitialState()

export class StaticDemoError extends Error {
  readonly status: number

  constructor(message: string, status = 501) {
    super(message)
    this.name = "StaticDemoError"
    this.status = status
  }
}

export function resetStaticDemoState(): void {
  state = makeInitialState()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function bodyRecord(init?: RequestInit): Record<string, unknown> {
  if (!init?.body || typeof init.body !== "string") return {}
  try {
    const value: unknown = JSON.parse(init.body)
    return value && typeof value === "object" ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function hasField(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field)
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  if (!hasField(record, field)) return undefined
  return String(record[field] ?? "").trim()
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

function practiceText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim()
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of ["value", "label", "text", "answer", "correct_answer"]) {
      const text = practiceText(record[key])
      if (text) return text
    }
  }
  return ""
}

function practiceAnswers(content: unknown): string[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) return []
  const record = content as Record<string, unknown>
  const raw = record.correct_answer ?? record.correctAnswer ?? record.answer
  const values = Array.isArray(raw) ? raw : [raw]
  return values.map(practiceText).filter(Boolean)
}

function practiceFeedback(content: unknown, keys: string[]): string {
  if (!content || typeof content !== "object" || Array.isArray(content)) return ""
  const record = content as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = practiceText(value)
      if (nested) return nested
    }
  }
  return ""
}

function lessonPracticeAttempt(
  lesson: Lesson,
  section: Lesson["sections"][number],
  body: Record<string, unknown>,
): LessonPracticeAttempt {
  if (typeof body.answer !== "string" || !body.answer.trim()) {
    throw new StaticDemoError("lesson practice answer is required", 400)
  }
  const elapsed = body.elapsed_ms === undefined ? 0 : body.elapsed_ms
  if (typeof elapsed !== "number" || !Number.isInteger(elapsed) || elapsed < 0) {
    throw new StaticDemoError("lesson practice elapsed_ms must be a non-negative integer", 400)
  }

  const answer = body.answer.trim()
  const expected = practiceAnswers(section.content)
  const normalizedAnswer = answer.trim().toLocaleLowerCase()
  const referenceAnswer = expected[0] ?? ""
  const evaluation: LessonPracticeEvaluation = expected.length === 0
    ? "ungraded"
    : expected.some((candidate) => candidate.toLocaleLowerCase() === normalizedAnswer)
      ? "correct"
      : "incorrect"
  const feedback = evaluation === "correct"
    ? practiceFeedback(section.content, ["correct_feedback", "correctFeedback", "feedback", "explanation"]) || "回答正确。"
    : evaluation === "incorrect"
      ? practiceFeedback(section.content, ["incorrect_feedback", "incorrectFeedback", "feedback", "explanation"]) || "请检查题目条件后再试。"
      : practiceFeedback(section.content, ["feedback", "explanation"]) || "暂无标准答案，请对照反馈复盘。"

  return {
    id: newID("lesson-attempt"),
    lesson_id: lesson.id,
    section_id: section.id,
    answer,
    evaluation,
    reference_answer: referenceAnswer,
    feedback,
    elapsed_ms: elapsed,
    created_at: DEMO_NOW,
  }
}

function withoutSecret(record: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...record }
  delete safe.api_key
  return safe
}

function newID(prefix: string): string {
  const id = `${prefix}-${state.sequence}`
  state.sequence += 1
  return id
}

function nextStaticTimestamp(previous: string): string {
  return new Date(Date.parse(previous) + 1).toISOString()
}

function qaRecordContextExists(contextType: StaticQARecordContextType, contextID: string): boolean {
  switch (contextType) {
    case "knowledge_item":
      return state.knowledge.some((item) => item.id === contextID)
    case "question":
      return state.mistakes.some((pair) => pair.question.id === contextID)
    case "lesson":
      return state.lessons.some((lesson) => lesson.id === contextID)
  }
}

function qaRecordFromBody(sessionID: string, body: Record<string, unknown>): StaticQARecord {
  const subject = String(body.subject ?? "").trim()
  if (!subject) throw new StaticDemoError("qa record subject is required", 400)

  const rawStatus = String(body.status ?? "").trim() || "open"
  if (!(["open", "understood", "follow_up"] as string[]).includes(rawStatus)) {
    throw new StaticDemoError("invalid qa record status", 400)
  }

  const contextType = String(body.context_type ?? "").trim()
  const contextID = String(body.context_id ?? "").trim()
  if (Boolean(contextType) !== Boolean(contextID)) {
    throw new StaticDemoError("qa record context type and id must be provided together", 400)
  }
  if (contextType && !(["knowledge_item", "question", "lesson"] as string[]).includes(contextType)) {
    throw new StaticDemoError("invalid qa record context type", 400)
  }
  if (contextType && !qaRecordContextExists(contextType as StaticQARecordContextType, contextID)) {
    throw new StaticDemoError("Static demo QA record context not found", 404)
  }

  const existing = state.qaRecords.get(sessionID)
  const createdAt = existing?.created_at ?? DEMO_NOW
  return {
    id: existing?.id ?? newID("qa"),
    session_id: sessionID,
    subject,
    ...(contextType ? {
      context_type: contextType as StaticQARecordContextType,
      context_id: contextID,
    } : {}),
    original_understanding: String(body.original_understanding ?? ""),
    corrected_model: String(body.corrected_model ?? ""),
    mastery_evidence: String(body.mastery_evidence ?? ""),
    unresolved: String(body.unresolved ?? ""),
    status: rawStatus as StaticQARecordStatus,
    created_at: createdAt,
    updated_at: existing ? nextStaticTimestamp(existing.updated_at) : createdAt,
  }
}

function subjectFrom(value: string | null): string | undefined {
  return value && value !== "all" ? value : undefined
}

function dashboard(subject: string | undefined): DashboardData {
  const knowledge = subject ? state.knowledge.filter((item) => item.subject === subject) : state.knowledge
  const due = subject ? state.due.filter((item) => state.knowledge.find((entry) => entry.id === item.knowledge.id)?.subject === subject) : state.due
  const subjectsDue: Record<string, number> = {}
  for (const item of state.due) {
    const owner = state.knowledge.find((entry) => entry.id === item.knowledge.id)?.subject
    if (owner) subjectsDue[owner] = (subjectsDue[owner] ?? 0) + 1
  }
  return {
    knowledge_count: knowledge.length,
    prompt_count: state.due.length + 4,
    due_count: due.length,
    attempt_count: 18,
    reviewed_today: 5,
    current_streak: 7,
    provider: state.activeProvider,
    offline: true,
    subjects_due: subjectsDue,
    recent_items: knowledge.slice(0, 4).map((item) => ({ id: item.id, term: item.term, item_type: item.item_type, subject: item.subject })),
  }
}

function knowledgeList(url: URL): KnowledgeListResponse {
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? ""
  const subject = subjectFrom(url.searchParams.get("subject"))
  const tag = url.searchParams.get("tag")?.trim().toLowerCase() ?? ""
  const group = url.searchParams.get("group")?.trim().toLowerCase() ?? ""
  const scheduled = url.searchParams.get("scheduled")
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0)
  const limit = Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100)
  const filtered = state.knowledge.filter((item) => {
    if (subject && item.subject !== subject) return false
    if (query && !`${item.term} ${item.concise_definition}`.toLowerCase().includes(query)) return false
    if (tag && !(item.tags ?? []).some((entry) => entry.toLowerCase() === tag)) return false
    if (group && !(item.tags ?? []).some((entry) => entry.toLowerCase() === group)) return false
    if (scheduled === "yes" && !state.scheduled.has(item.id)) return false
    if (scheduled === "no" && state.scheduled.has(item.id)) return false
    return true
  })
  const items = filtered.slice(offset, offset + limit)
  return { items: clone(items), count: filtered.length, scheduled_ids: items.filter((item) => state.scheduled.has(item.id)).map((item) => item.id) }
}

function chatConversations(subject: string | undefined) {
  const grouped = new Map<string, ChatMessage[]>()
  for (const message of state.messages) {
    if (subject && message.subject !== subject) continue
    const session = message.session_id ?? "session-demo"
    const list = grouped.get(session) ?? []
    list.push(message)
    grouped.set(session, list)
  }
  const items = [...grouped.entries()].map(([session_id, messages]) => {
    const first = messages[0]
    const last = messages[messages.length - 1]
    return {
      session_id,
      subject: first?.subject,
      message_count: messages.length,
      last_at: last?.created_at ?? DEMO_NOW,
      title: first?.content?.slice(0, 32) || "Demo conversation",
      preview: last?.content?.slice(0, 80),
    }
  })
  return { items: clone(items), count: items.length }
}

function integratedNote(input: Record<string, unknown>): IntegratedNote {
  const source = String(input.text ?? "").trim()
  const knowledgeID = String(input.knowledge_id ?? "")
  const item = state.knowledge.find((entry) => entry.id === knowledgeID)
  const title = item?.term || source.split(/\r?\n/)[0]?.replace(/^#+\s*/, "") || "Static integrated note"
  const note: IntegratedNote = {
    id: newID("integrate"),
    subject: String(input.subject ?? "") || undefined,
    title,
    source_type: item ? "knowledge" : "text",
    source_id: item?.id,
    mindmap: {
      title,
      nodes: [
        { id: "root", label: title, node_type: "root", note: source || item?.concise_definition },
        { id: "point-1", label: "Definition", parent_id: "root", node_type: "section", note: item?.concise_definition ?? "A concise summary from the demo fixture." },
        { id: "point-2", label: "Next review", parent_id: "root", node_type: "section", note: "Turn the idea into one small retrieval prompt." },
      ],
    },
    cards: [
      { id: newID("card"), card_type: "conclusion", title: "Remember", body: item?.concise_definition ?? "Keep one sentence that captures the idea.", tags: ["demo"] },
      { id: newID("card"), card_type: "strategy", title: "Apply", body: "Use the idea in a fresh example before the next review.", tags: ["practice"] },
    ],
    created_at: DEMO_NOW,
  }
  state.notes.unshift(note)
  return note
}

function articleFrom(input: Record<string, unknown>, id = newID("article")): EnglishArticle {
  const original = String(input.original_text ?? "").trim() || "A short static demo article about learning."
  const title = String(input.title ?? input.original_title ?? "Static demo article")
  const content: EnglishArticleContent = {
    title,
    metadata: {
      original_title: String(input.original_title ?? title),
      author: String(input.author ?? "Study OS"),
      source_name: String(input.source_name ?? "GitHub Pages demo"),
      source_url: String(input.source_url ?? "") || undefined,
      published_at: String(input.published_at ?? "2026-08-18"),
    },
    sections: [{
      title: "Reading note",
      paragraphs: [{ segments: [{ text: original }], translation: "这是 GitHub Pages 展示模式生成的双语段落。" }],
    }],
  }
  return {
    id,
    title,
    original_title: content.metadata.original_title,
    author: content.metadata.author,
    source_name: content.metadata.source_name,
    source_url: content.metadata.source_url,
    published_at: content.metadata.published_at,
    original_text: original,
    content,
    section_count: content.sections.length,
    provider: "mock",
    model: "static-demo",
    created_at: DEMO_NOW,
    updated_at: DEMO_NOW,
  }
}

function mistakeList(subject: string | undefined) {
  const items = subject ? state.mistakes.filter((entry) => entry.question.subject === subject) : state.mistakes
  return { items: clone(items), count: items.length }
}

function errorCauseList(url: URL) {
  const subject = url.searchParams.get("subject")?.trim().toLowerCase() ?? ""
  const status = url.searchParams.get("status")?.trim().toLowerCase() || "confirmed"
  if (!["candidate", "confirmed", "archived", "all"].includes(status)) {
    throw new StaticDemoError("invalid error cause status", 400)
  }
  const filtered = state.errorCauses
    .filter((cause) =>
      (cause.subject === "" || cause.subject === subject)
      && (status === "all" || cause.status === status),
    )
    .sort((left, right) => {
      const scope = Number(left.subject !== "") - Number(right.subject !== "")
      return scope || left.sort_order - right.sort_order || left.id.localeCompare(right.id)
    })
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0)
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? 200) || 200))
  const items = filtered.slice(offset, offset + limit)
  return { items, count: items.length }
}

function validateStaticErrorCauseParent(subject: string, parentID: string, id: string): void {
  if (!parentID) return
  if (parentID === id) throw new StaticDemoError("error cause cannot be its own parent", 400)
  const parent = state.errorCauses.find((cause) => cause.id === parentID)
  if (!parent) throw new StaticDemoError("parent error cause does not exist", 400)
  if (parent.subject && parent.subject !== subject) {
    throw new StaticDemoError("parent error cause belongs to another subject", 400)
  }
  if (!subject && parent.subject) {
    throw new StaticDemoError("global error cause cannot use a subject parent", 400)
  }
}

function errorCauseFromBody(body: Record<string, unknown>): StaticErrorCause {
  const id = String(body.id ?? newID("cause")).trim().toLowerCase()
  const subject = String(body.subject ?? "").trim().toLowerCase()
  const parentID = String(body.parent_id ?? "").trim().toLowerCase()
  const label = String(body.label ?? "").trim()
  const sourceType = String(body.source_type ?? "").trim().toLowerCase()
  const sourceID = String(body.source_id ?? "").trim()
  const sortOrder = body.sort_order === undefined ? 0 : Number(body.sort_order)
  if (!/^[a-z0-9][a-z0-9:_-]{0,95}$/.test(id)) throw new StaticDemoError("invalid error cause id", 400)
  if (!label) throw new StaticDemoError("error cause label is required", 400)
  if (!Number.isInteger(sortOrder) || sortOrder < 0) throw new StaticDemoError("invalid error cause sort_order", 400)
  if (Boolean(sourceType) !== Boolean(sourceID)) {
    throw new StaticDemoError("error cause source_type and source_id must be provided together", 400)
  }
  if (state.errorCauses.some((cause) => cause.id === id)) {
    throw new StaticDemoError("error cause already exists", 409)
  }
  validateStaticErrorCauseParent(subject, parentID, id)
  return {
    id,
    subject,
    ...(parentID ? { parent_id: parentID } : {}),
    label,
    review_fixes: body.review_fixes === true,
    action: String(body.action ?? "").trim(),
    status: "candidate",
    ...(sourceType ? { source_type: sourceType, source_id: sourceID } : {}),
    sort_order: sortOrder,
    created_at: DEMO_NOW,
    updated_at: DEMO_NOW,
  }
}

function statusPayload() {
  const activeVendor = state.vendors.find((vendor) => vendor.id === state.activeProvider)
  const models = stringList(activeVendor?.models)
  return {
    provider: {
      name: state.activeProvider,
      mode: "local",
      configured: true,
      available: true,
      key_configured: Boolean(activeVendor?.key_configured),
      model: String(activeVendor?.model ?? models[0] ?? "static-demo"),
    },
    data: { directory: "browser memory", database_path: "Pages demo (not persisted)" },
    review: { daily_limit: state.dailyLimit },
    backup: { directory: "browser memory", count: state.backups.length, last_created_at: state.backups[0]?.created_at },
    app: { version: "Pages demo", platform: "github-pages" },
  }
}

function parsePath(path: string): { url: URL; parts: string[] } {
  const url = new URL(path, "https://study-os.static")
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part))
  return { url, parts }
}

function methodOf(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase()
}

function responseFor<T>(value: T): T {
  return clone(value)
}

/**
 * Deterministic in-memory replacement for the backend API used by Pages.
 * Keeping the route surface here means existing page components remain the
 * same in local and static builds, while every mutation is naturally scoped to
 * the current browser tab.
 */
export async function staticDemoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, parts } = parsePath(path)
  const method = methodOf(init)
  const body = bodyRecord(init)
  const [root, id, action] = parts

  if (method === "GET" && root === "update" && id === "status") {
    return responseFor({ current_version: "Pages demo", update_available: false, checked_at: DEMO_NOW }) as T
  }
  if (method === "POST" && root === "update" && id === "apply") {
    return responseFor({ status: "static-demo" }) as T
  }

  if (method === "GET" && root === "dashboard") return responseFor(dashboard(subjectFrom(url.searchParams.get("subject")))) as T
  if (method === "POST" && root === "demo" && id === "seed") {
    return responseFor({ status: "seeded", knowledge_id: state.knowledge[0]?.id ?? "", prompt_count: state.due.length }) as T
  }
  if (method === "POST" && root === "dump") {
    const text = String(body.text ?? "").trim()
    const firstLine = text.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean)
    const term = (firstLine || "Pages demo note").slice(0, 120)
    const item: KnowledgeItem = {
      id: newID("knowledge"),
      item_type: "brain_dump",
      term,
      concise_definition: text.slice(0, 240) || "A note saved in the Pages demo.",
      detailed_markdown: text || `## ${term}`,
      level: "demo",
      subject: "english",
      tags: ["english-core", "reading"],
    }
    state.knowledge.unshift(item)
    return responseFor({ id: item.id, term: item.term }) as T
  }

  if (root === "groups" && method === "GET") return responseFor({ items: state.groups, count: state.groups.length }) as T
  if (root === "knowledge" && id === "lookup" && method === "POST") {
    const term = String(body.term ?? "").trim()
    if (!term) throw new StaticDemoError("Static demo lookup needs a term")
    const existing = state.knowledge.find((item) => item.term.toLowerCase() === term.toLowerCase())
    if (existing) return responseFor({ source: "existing", item: existing }) as T
    const item: KnowledgeItem = {
      id: newID("knowledge"),
      item_type: body.kind === "expression" ? "expression_wiki" : "word_wiki",
      term,
      concise_definition: `A generated Pages demo definition for ${term}.`,
      detailed_markdown: `## ${term}\n\nThis item was generated locally in the static demo.\n\nContext: ${String(body.context ?? "")}`,
      example: `Try using “${term}” in a new sentence.`,
      level: "demo",
      subject: "english",
      tags: ["generated"],
    }
    state.knowledge.unshift(item)
    return responseFor({ source: "generated", item }) as T
  }
  if (root === "knowledge" && !id && method === "GET") return responseFor(knowledgeList(url)) as T
  if (root === "knowledge" && id && action === "related" && method === "GET") {
    const item = state.knowledge.find((entry) => entry.id === id)
    const tags = new Set(item?.tags ?? [])
    const items = state.knowledge.filter((entry) => entry.id !== id && (entry.tags ?? []).some((tag) => tags.has(tag)))
    return responseFor({ items, groups: state.groups.filter((group) => tags.has(group.id) || tags.has(group.name.toLowerCase())) }) as T
  }
  if (root === "knowledge" && id && action === "schedule" && method === "POST") {
    const item = state.knowledge.find((entry) => entry.id === id)
    if (!item) throw new StaticDemoError("Static demo knowledge item not found")
    const already = state.scheduled.has(id)
    state.scheduled.add(id)
    if (!state.due.some((entry) => entry.knowledge.id === id)) {
      state.due.push(makeDue(item, state.due.length))
    }
    return responseFor({ status: already ? "already_scheduled" : "scheduled", knowledge_id: id, prompt_count: 1 }) as T
  }
  if (root === "knowledge" && id && action === "wiki" && method === "PUT") {
    const item = state.knowledge.find((entry) => entry.id === id)
    if (!item) throw new StaticDemoError("Static demo knowledge item not found")
    item.detailed_markdown = String(body.detailed_markdown ?? "")
    return responseFor(item) as T
  }
  if (root === "knowledge" && id && action === "tag" && method === "POST") {
    const item = state.knowledge.find((entry) => entry.id === id)
    if (!item) throw new StaticDemoError("Static demo knowledge item not found")
    const tag = String(body.tag ?? "").trim()
    const tags = new Set(item.tags ?? [])
    if (body.remove === true) tags.delete(tag)
    else if (tag) tags.add(tag)
    item.tags = [...tags]
    return responseFor(item) as T
  }
  if (root === "knowledge" && id && method === "GET") {
    const item = state.knowledge.find((entry) => entry.id === id)
    if (!item) throw new StaticDemoError("Static demo knowledge item not found")
    return responseFor(item) as T
  }

  if (root === "reviews" && id === "due" && method === "GET") {
    const subject = subjectFrom(url.searchParams.get("subject"))
    const items = subject
      ? state.due.filter((entry) => state.knowledge.find((item) => item.id === entry.knowledge.id)?.subject === subject)
      : state.due
    return responseFor({ items }) as T
  }
  if (root === "reviews" && id === "forecast" && method === "GET") {
    const days = Math.max(1, Number(url.searchParams.get("days") ?? 7) || 7)
    const subject = subjectFrom(url.searchParams.get("subject"))
    const dueCount = subject
      ? state.due.filter((entry) => state.knowledge.find((item) => item.id === entry.knowledge.id)?.subject === subject).length
      : state.due.length
    const first = new Date(DEMO_NOW)
    const result = Array.from({ length: days }, (_, index) => {
      const date = new Date(first)
      date.setUTCDate(date.getUTCDate() + index)
      return { date: date.toISOString().slice(0, 10), count: Math.max(0, dueCount - index) }
    })
    return responseFor({ days: result, horizon: days }) as T
  }
  if (root === "reviews" && id && action === "answer" && method === "POST") {
    const due = state.due.find((entry) => entry.prompt.id === id)
    if (!due) throw new StaticDemoError("Static demo review prompt not found")
    state.due = state.due.filter((entry) => entry.prompt.id !== id)
    const knowledge = state.knowledge.find((entry) => entry.id === due.knowledge.id)
    const expectedAnswer = knowledge?.concise_definition ?? due.prompt.options?.[0] ?? ""
    const evaluation: ReviewEvaluation = {
      attempt_id: newID("attempt"),
      outcome: "correct",
      rating: 3,
      feedback: "Good retrieval. The next interval is longer.",
      due_at: DEMO_NOW,
      expected_answers: expectedAnswer ? [expectedAnswer] : [],
    }
    return responseFor(evaluation) as T
  }
  if (root === "attempts" && id && action === "override" && method === "POST") {
    return responseFor({ attempt_id: id, outcome: "correct", rating: Number(body.rating ?? 3), feedback: "Saved in the Pages demo.", due_at: DEMO_NOW, expected_answers: [] }) as T
  }

  if (root === "chat" && id === "conversations" && method === "GET") return responseFor(chatConversations(subjectFrom(url.searchParams.get("subject")))) as T
  if (root === "chat" && id === "records") {
    const sessionID = String(action ?? "").trim()
    if (!sessionID) throw new StaticDemoError("session id is required", 400)
    if (!state.messages.some((message) => message.session_id === sessionID)) {
      throw new StaticDemoError("Static demo chat session not found", 404)
    }
    if (method === "GET") {
      const record = state.qaRecords.get(sessionID)
      if (!record) throw new StaticDemoError("Static demo QA record not found", 404)
      return responseFor(record) as T
    }
    if (method === "PUT") {
      const record = qaRecordFromBody(sessionID, body)
      state.qaRecords.set(sessionID, record)
      return responseFor(record) as T
    }
  }
  if (root === "chat" && id === "messages" && method === "GET") {
    const session = url.searchParams.get("session_id")
    const subject = subjectFrom(url.searchParams.get("subject"))
    const items = state.messages.filter((message) => (!session || message.session_id === session) && (!subject || message.subject === subject))
    return responseFor({ items, count: items.length }) as T
  }
  if (root === "chat" && id === "attachments" && method === "POST") {
    return responseFor({ id: newID("attachment"), name: "demo-attachment.txt", size_bytes: 128, kind: "text" }) as T
  }
  if (root === "chat" && !id && method === "POST") {
    const session = String(body.session_id ?? newID("session"))
    const subject = String(body.subject ?? "all")
    const message = String(body.message ?? "")
    const created = new Date().toISOString()
    state.messages.push(
      { id: newID("message"), session_id: session, subject, role: "user", content: message, status: "done", created_at: created },
      { id: newID("message"), session_id: session, subject, role: "assistant", content: "In the static demo, the key is to retrieve first, then schedule the next review while the idea is still fresh.", status: "done", created_at: created },
    )
    return responseFor({ session_id: session, message_id: state.messages[state.messages.length - 1]?.id ?? "", status: "completed" }) as T
  }
  if (root === "compare" && method === "POST") return responseFor({ summary: `Compare ${String(body.term_a ?? "A")} and ${String(body.term_b ?? "B")} by definition, usage, and context.`, same_points: ["Both are study targets."], diff_points: ["Their contexts differ."], memory_tip: "Write one contrast sentence." }) as T

  if (root === "integrate" && !id && method === "GET") {
    const subject = subjectFrom(url.searchParams.get("subject"))
    const items = subject ? state.notes.filter((entry) => entry.subject === subject) : state.notes
    return responseFor({ items, count: items.length }) as T
  }
  if (root === "integrate" && !id && method === "POST") return responseFor(integratedNote(body)) as T
  if (root === "integrate" && id && method === "GET") {
    const note = state.notes.find((entry) => entry.id === id)
    if (!note) throw new StaticDemoError("Static demo note not found")
    return responseFor(note) as T
  }

  if (root === "lessons" && !id && method === "GET") {
    const subject = subjectFrom(url.searchParams.get("subject"))
    const status = url.searchParams.get("status")
    if (status && !["draft", "reviewed", "published", "archived"].includes(status)) {
      throw new StaticDemoError("invalid lesson status", 400)
    }
    const filtered = state.lessons.filter((lesson) => (!subject || lesson.subject === subject) && (!status || lesson.status === status))
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0)
    const requestedLimit = url.searchParams.get("limit")
    const limit = Math.max(1, Number(requestedLimit ?? filtered.length) || filtered.length || 1)
    return responseFor({ items: filtered.slice(offset, offset + limit), count: filtered.length }) as T
  }
  if (root === "lessons" && id && action === "practice" && parts[4] === "attempts" && (method === "POST" || method === "GET")) {
    const lesson = state.lessons.find((entry) => entry.id === id)
    if (!lesson) throw new StaticDemoError("Static demo lesson not found", 404)
    const sectionID = parts[3] ?? ""
    const section = lesson.sections.find((entry) => entry.id === sectionID)
    if (!section) throw new StaticDemoError("Static demo lesson practice section not found", 404)
    if (method === "POST") {
      const attempt = lessonPracticeAttempt(lesson, section, body)
      state.lessonAttempts.push(attempt)
      return responseFor(attempt) as T
    }
    const items = state.lessonAttempts
      .filter((entry) => entry.lesson_id === lesson.id && entry.section_id === section.id)
      .reverse()
    return responseFor({ items, count: items.length }) as T
  }
  if (root === "lessons" && id && method === "GET") {
    const lesson = state.lessons.find((entry) => entry.id === id)
    if (!lesson) throw new StaticDemoError("Static demo lesson not found")
    return responseFor(lesson) as T
  }

  if (root === "error-causes" && !id && method === "GET") return responseFor(errorCauseList(url)) as T
  if (root === "error-causes" && !id && method === "POST") {
    const cause = errorCauseFromBody(body)
    state.errorCauses.push(cause)
    return responseFor(cause) as T
  }
  if (root === "error-causes" && id && method === "PATCH") {
    const cause = state.errorCauses.find((entry) => entry.id === id)
    if (!cause) throw new StaticDemoError("Static demo error cause not found", 404)
    if (hasField(body, "subject") && String(body.subject ?? "").trim().toLowerCase() !== cause.subject) {
      throw new StaticDemoError("error cause subject is immutable", 400)
    }
    const parentID = hasField(body, "parent_id")
      ? String(body.parent_id ?? "").trim().toLowerCase()
      : cause.parent_id ?? ""
    validateStaticErrorCauseParent(cause.subject, parentID, cause.id)
    const status = hasField(body, "status") ? String(body.status ?? "").trim().toLowerCase() : cause.status
    if (!["candidate", "confirmed", "archived"].includes(status)) {
      throw new StaticDemoError("invalid error cause status", 400)
    }
    const label = hasField(body, "label") ? String(body.label ?? "").trim() : cause.label
    if (!label) throw new StaticDemoError("error cause label is required", 400)
    const sourceType = hasField(body, "source_type")
      ? String(body.source_type ?? "").trim().toLowerCase()
      : cause.source_type ?? ""
    const sourceID = hasField(body, "source_id") ? String(body.source_id ?? "").trim() : cause.source_id ?? ""
    if (Boolean(sourceType) !== Boolean(sourceID)) {
      throw new StaticDemoError("error cause source_type and source_id must be provided together", 400)
    }
    const sortOrder = hasField(body, "sort_order") ? Number(body.sort_order) : cause.sort_order
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new StaticDemoError("invalid error cause sort_order", 400)
    }
    Object.assign(cause, {
      parent_id: parentID || undefined,
      label,
      review_fixes: hasField(body, "review_fixes") ? body.review_fixes === true : cause.review_fixes,
      action: hasField(body, "action") ? String(body.action ?? "").trim() : cause.action,
      status: status as StaticErrorCause["status"],
      source_type: sourceType || undefined,
      source_id: sourceID || undefined,
      sort_order: sortOrder,
      updated_at: DEMO_NOW,
    })
    return responseFor(cause) as T
  }

  if (root === "mistakes" && !id && method === "GET") return responseFor(mistakeList(subjectFrom(url.searchParams.get("subject")))) as T
  if (root === "mistakes" && !id && method === "POST") {
    const subject = String(body.subject ?? "all").trim().toLowerCase()
    let evidence: MistakeEvidence | undefined
    try {
      evidence = normalizeSubjectAttemptEvidence(subject, body.evidence)
    } catch (error) {
      throw new StaticDemoError(error instanceof Error ? error.message : "invalid subject attempt evidence", 400)
    }
    const pair: StaticMistakePair = {
      question: { id: newID("question"), subject, stem: String(body.stem ?? ""), created_at: DEMO_NOW },
      attempt: {
        id: newID("attempt"),
        question_id: "",
        cause: String(body.cause ?? "unknown"),
        note: String(body.note ?? ""),
        answer: String(body.answer ?? "").trim() || undefined,
        elapsed_ms: body.elapsed_ms === undefined ? 0 : Math.max(0, Math.trunc(Number(body.elapsed_ms) || 0)),
        is_correct: false,
        occurred_at: DEMO_NOW,
        ...(evidence ? { evidence } : {}),
      },
    }
    pair.attempt.question_id = pair.question.id
    state.mistakes.unshift(pair)
    return responseFor(pair) as T
  }
  if (root === "mistakes" && id && action === "evidence" && method === "PATCH") {
    const pair = state.mistakes.find((entry) => entry.attempt.id === id)
    if (!pair) throw new StaticDemoError("Static demo mistake not found", 404)
    try {
      const evidence = normalizeSubjectAttemptEvidence(pair.question.subject, body.evidence)
      if (evidence) pair.attempt.evidence = evidence
      else delete pair.attempt.evidence
    } catch (error) {
      throw new StaticDemoError(error instanceof Error ? error.message : "invalid subject attempt evidence", 400)
    }
    return responseFor(pair) as T
  }
  if (root === "mistakes" && id && action === "schedule" && method === "POST") {
    const pair = state.mistakes.find((entry) => entry.attempt.id === id)
    if (!pair) throw new StaticDemoError("Static demo mistake not found")
    const policy = state.errorCauses.find((cause) =>
      cause.id === pair.attempt.cause
      && cause.status === "confirmed"
      && (cause.subject === "" || cause.subject === pair.question.subject),
    )
    if (!policy?.review_fixes) {
      throw new StaticDemoError("This error cause is not fixed by more review", 400)
    }
    pair.question.knowledge_item_id = pair.question.knowledge_item_id ?? state.knowledge[0]?.id
    return responseFor({ knowledge_id: pair.question.knowledge_item_id ?? "" }) as T
  }
  if (root === "mistakes" && id && action === "cause" && method === "PATCH") {
    const pair = state.mistakes.find((entry) => entry.attempt.id === id)
    if (!pair) throw new StaticDemoError("Static demo mistake not found", 404)
    const causeID = String(body.cause ?? "").trim()
    const cause = state.errorCauses.find((entry) =>
      entry.id === causeID
      && entry.status === "confirmed"
      && (entry.subject === "" || entry.subject === pair.question.subject),
    )
    if (!cause) throw new StaticDemoError("cause is not confirmed for this subject", 400)
    pair.attempt.cause = cause.id
    return responseFor(pair) as T
  }
  if (root === "mistakes" && id && action === "correct" && method === "POST") {
    const pair = state.mistakes.find((entry) => entry.attempt.id === id)
    if (!pair) throw new StaticDemoError("Static demo mistake not found")
    const answer = String(body.answer ?? "").trim()
    const elapsedMS = Number(body.elapsed_ms)
    if (!answer) throw new StaticDemoError("correction answer is required", 400)
    if (!Number.isFinite(elapsedMS) || elapsedMS < 0) throw new StaticDemoError("correction elapsed_ms cannot be negative", 400)
    if (pair.correction) return responseFor(pair) as T
    const correctedAt = DEMO_NOW
    pair.correction = {
      id: newID("attempt"),
      question_id: pair.question.id,
      answer,
      elapsed_ms: Math.trunc(elapsedMS),
      is_correct: true,
      occurred_at: correctedAt,
    }
    pair.corrected = true
    return responseFor(pair) as T
  }
  if (root === "mistakes" && id && method === "DELETE") {
    state.mistakes = state.mistakes.filter((entry) => entry.attempt.id !== id)
    return undefined as T
  }

  if (root === "english" && id === "articles" && !action && method === "GET") return responseFor({ items: state.articles, count: state.articles.length }) as T
  if (root === "english" && id === "articles" && action === "generate" && method === "POST") return responseFor(articleFrom(body)) as T
  if (root === "english" && id === "articles" && !action && method === "POST") {
    const article = articleFrom(body, typeof body.id === "string" ? body.id : newID("article"))
    state.articles = [article, ...state.articles.filter((entry) => entry.id !== article.id)]
    return responseFor(article) as T
  }
  if (root === "english" && id === "articles" && parts[2] && method === "GET") {
    const article = state.articles.find((entry) => entry.id === parts[2])
    if (!article) throw new StaticDemoError("Static demo article not found")
    return responseFor(article) as T
  }
  if (root === "english" && id === "articles" && parts[2] && parts[3] === "regenerate" && method === "POST") {
    const article = state.articles.find((entry) => entry.id === parts[2])
    if (!article) throw new StaticDemoError("Static demo article not found")
    article.updated_at = DEMO_NOW
    return responseFor(article) as T
  }
  if (root === "english" && id === "articles" && parts[2] && method === "DELETE") {
    state.articles = state.articles.filter((entry) => entry.id !== parts[2])
    return undefined as T
  }

  if (root === "system" && id === "status" && method === "GET") return responseFor(statusPayload()) as T
  if (root === "backups" && method === "GET") return responseFor({ items: state.backups, count: state.backups.length }) as T
  if (root === "backups" && method === "POST") {
    const backup = { id: newID("backup"), category: String(body.category ?? "daily"), path: "browser-memory", sha256: "static-demo", size_bytes: 0, created_at: DEMO_NOW }
    state.backups.unshift(backup)
    return responseFor(backup) as T
  }
  if (root === "settings" && method === "PATCH") {
    state.dailyLimit = Math.max(1, Math.trunc(Number(body.daily_limit ?? state.dailyLimit)))
    return responseFor({ daily_limit: state.dailyLimit }) as T
  }
  if (root === "agent" && id === "vendors" && method === "GET") return responseFor({ active_provider: state.activeProvider, items: state.vendors }) as T
  if (root === "agent" && id === "active" && method === "PATCH") {
    state.activeProvider = String(body.provider ?? state.activeProvider)
    state.vendors = state.vendors.map((vendor) => ({ ...vendor, active: vendor.id === state.activeProvider }))
    return responseFor({ active_provider: state.activeProvider }) as T
  }
  if (root === "agent" && id === "test" && method === "POST") return responseFor({ ok: true, provider: String(body.provider ?? state.activeProvider), latency_ms: 12 }) as T
  if (root === "agent" && id === "config" && method === "PATCH") {
    const provider = String(body.provider ?? state.activeProvider)
    const vendor = state.vendors.find((entry) => entry.id === provider)
    if (!vendor) throw new StaticDemoError("Static demo provider not found")

    const apiKey = stringField(body, "api_key")
    const model = stringField(body, "model")
    const reasoningModel = stringField(body, "reasoning_model")
    const baseURL = stringField(body, "base_url")
    const models = [...stringList(vendor.models)]
    for (const candidate of [model, reasoningModel]) {
      if (candidate && !models.includes(candidate)) models.push(candidate)
    }
    const updatedVendor = {
      ...vendor,
      ...(hasField(body, "api_key") ? { key_configured: Boolean(apiKey) } : {}),
      ...(hasField(body, "base_url") ? { base_url: baseURL ?? "" } : {}),
      ...(hasField(body, "model") ? { model: model ?? "" } : {}),
      ...(hasField(body, "reasoning_model") ? { reasoning_model: reasoningModel ?? "" } : {}),
      models,
    }
    state.vendors = state.vendors.map((entry) => entry.id === provider ? updatedVendor : entry)
    return responseFor({
      provider,
      key_configured: Boolean(updatedVendor.key_configured),
      base_url: String(updatedVendor.base_url ?? ""),
      model: String(updatedVendor.model ?? model ?? models[0] ?? "static-demo"),
      reasoning_model: String(updatedVendor.reasoning_model ?? reasoningModel ?? ""),
    }) as T
  }

  if (root === "speech" && !id && method === "GET") return responseFor({ speech: withoutSecret(state.speech), roles: state.roles, active_role_id: state.activeRoleId }) as T
  if (root === "speech" && id === "roles" && !action && method === "GET") return responseFor({ items: state.roles, count: state.roles.length, active_role_id: state.activeRoleId }) as T
  if (root === "speech" && id === "config" && method === "PATCH") {
    const nextSpeech = { ...state.speech }
    for (const field of ["provider", "base_url", "model", "voice", "format"]) {
      if (hasField(body, field)) nextSpeech[field] = String(body[field] ?? "").trim()
    }
    if (hasField(body, "api_key")) nextSpeech.key_configured = Boolean(stringField(body, "api_key"))
    nextSpeech.configured = true
    state.speech = withoutSecret(nextSpeech)
    return responseFor({ speech: withoutSecret(state.speech) }) as T
  }
  if (root === "speech" && id === "roles" && action === "active" && method === "PATCH") {
    state.activeRoleId = String(body.role_id ?? "")
    return responseFor({ active_role_id: state.activeRoleId }) as T
  }
  if (root === "speech" && id === "roles" && !action && method === "POST") {
    const role = { id: newID("role"), ...body, has_avatar: false, created_at: DEMO_NOW, updated_at: DEMO_NOW }
    state.roles.push(role)
    return responseFor(role) as T
  }
  if (root === "speech" && id === "roles" && action && parts[3] === "avatar" && method === "POST") {
    const role = state.roles.find((entry) => entry.id === action)
    if (!role) throw new StaticDemoError("Static demo voice role not found")
    role.has_avatar = true
    return responseFor({ id: action, has_avatar: true, size_bytes: 0 }) as T
  }
  if (root === "speech" && id === "roles" && action && method === "POST") {
    const role = { id: newID("role"), ...body, has_avatar: false, created_at: DEMO_NOW, updated_at: DEMO_NOW }
    state.roles.push(role)
    return responseFor(role) as T
  }
  if (root === "speech" && id === "roles" && action && method === "PATCH") {
    const role = state.roles.find((entry) => entry.id === action)
    if (!role) throw new StaticDemoError("Static demo voice role not found")
    Object.assign(role, body, { updated_at: DEMO_NOW })
    return responseFor(role) as T
  }
  if (root === "speech" && id === "roles" && action && method === "DELETE") {
    state.roles = state.roles.filter((entry) => entry.id !== action)
    return undefined as T
  }

  if (root === "imports" && !id && method === "POST") {
    const jobId = newID("import")
    state.imports.set(jobId, { jobId, previewed: false, committed: false })
    return responseFor({ job_id: jobId, inspection: { format: "csv", tables: ["words"], selected_table: "words", columns: ["term", "definition"], sample_rows: [{ term: "resilient", definition: "able to recover" }], row_count: 1 } }) as T
  }
  if (root === "imports" && id && action === "preview" && method === "POST") {
    const job = state.imports.get(id)
    if (job) job.previewed = true
    return responseFor({ job_id: id, state: "previewed", mapping: body.mapping ?? {}, summary: { rows: 1, insert: 1, exact_duplicate: 0, review: 0, new_sense: 0, invalid: 0 }, rows: [{ row_id: "row-1", row_number: 1, raw: { term: "resilient", definition: "able to recover" }, normalized: { term: "resilient", definition: "able to recover" }, disposition: "insert" }] }) as T
  }
  if (root === "imports" && id && action === "commit" && method === "POST") {
    const job = state.imports.get(id)
    if (!job) throw new StaticDemoError("Static demo import job not found")
    if (!job.committed) {
      const existing = state.knowledge.find((item) => item.term.toLowerCase() === "resilient")
      if (!existing) {
        const item: KnowledgeItem = {
          id: newID("knowledge"),
          item_type: "word_wiki",
          term: "resilient",
          concise_definition: "able to recover quickly after difficulty",
          detailed_markdown: "## resilient\n\nAble to recover quickly after difficulty.",
          example: "A resilient learner returns to a hard idea.",
          level: "demo",
          subject: "english",
          tags: ["english-core", "imported"],
        }
        state.knowledge.unshift(item)
        state.scheduled.add(item.id)
        state.due.push(makeDue(item, state.due.length))
      }
      job.committed = true
    }
    return responseFor({ job_id: id, state: "committed", summary: { inserted: 1, exact_duplicates: 0, merged: 0, pending_reviews: 1, rejected: 0, prompts_created: 1 } }) as T
  }

  throw new StaticDemoError(`Static demo does not implement ${method} ${url.pathname}`)
}
