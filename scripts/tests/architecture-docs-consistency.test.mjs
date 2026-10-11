import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8")
}

const roadmap = read("ROADMAP.md")
const databaseSource = read("backend/db/db.go")
const schema = read("backend/db/schema.sql")

function currentSchemaVersion() {
  const match = databaseSource.match(/const currentSchemaVersion = (\d+)/)
  assert.ok(match, "backend/db/db.go must expose the schema head as a literal")
  return Number(match[1])
}

function tablePattern(name) {
  return new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+${name}\\b`)
}

test("ROADMAP follows the database schema head", () => {
  const version = currentSchemaVersion()

  assert.match(roadmap, new RegExp(`schema 版本 ${version}\\b`))
  assert.doesNotMatch(roadmap, /schema 版本 7\b/)
})

test("ROADMAP names persisted objects instead of stale browser-only gaps", () => {
  for (const table of [
    "questions",
    "question_attempts",
    "voice_roles",
    "english_articles",
    "lessons",
    "lesson_versions",
    "lesson_links",
    "lesson_attempts",
    "error_causes",
    "qa_records",
  ]) {
    assert.match(schema, tablePattern(table), `schema is missing ${table}`)
    assert.match(roadmap, new RegExp(`\\b${table}\\b`), `ROADMAP is missing ${table}`)
  }

  assert.match(roadmap, /题目 Question\s*\|\s*✅/)
  assert.match(roadmap, /错因 Error Cause\s*\|\s*✅/)
  assert.match(roadmap, /课程 Lesson\s*\|\s*🟡/)
  assert.match(roadmap, /\/api\/mistakes/)
  assert.doesNotMatch(roadmap, /题目 Question\s*\|\s*❌/)
  assert.doesNotMatch(roadmap, /错因 Error Cause\s*\|\s*❌/)
  assert.doesNotMatch(roadmap, /课程 Lesson\s*\|\s*❌/)
  assert.doesNotMatch(roadmap, /error_causes`：\*\*尚未完成\*\*/)
})

test("ROADMAP records question-attempt evidence at the schema head", () => {
  assert.match(schema, /answer TEXT NOT NULL DEFAULT ''/)
  assert.match(schema, /elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK \(elapsed_ms >= 0\)/)
  assert.match(schema, /is_correct INTEGER NOT NULL DEFAULT 0 CHECK \(is_correct IN \(0, 1\)\)/)
  assert.match(databaseSource, /case 15:/)
  assert.match(databaseSource, /ALTER TABLE question_attempts ADD COLUMN answer/)
  assert.match(roadmap, /schema v15[\s\S]*question_attempts[\s\S]*answer[\s\S]*elapsed_ms[\s\S]*is_correct/)
  assert.match(roadmap, /schema v16[\s\S]*error_causes[\s\S]*GET \/api\/error-causes/)
  assert.match(roadmap, /schema v17[\s\S]*qa_records[\s\S]*chat_messages\.session_id/)
  assert.match(roadmap, /GET\/PUT \/api\/chat\/records\/\{sessionID\}/)
  assert.match(roadmap, /Pages[\s\S]*答疑页单列编辑面板/)
  // The flow-back shipped, so this no longer reads as a pending step -- but the
  // constraint it recorded (no card is scheduled without a click) still has to
  // stay written down, or the next change has nothing stopping it from
  // scheduling off a half-written record.
  assert.match(roadmap, /回流[\s\S]*不做未经用户确认的自动写入[\s\S]*保存记录本身不会排卡/)
  assert.doesNotMatch(roadmap, /答疑记录 Q&A[^\n]*交互待落地/)
  assert.doesNotMatch(roadmap, /待接入 API、Pages 与答疑页/)
  assert.match(roadmap, /POST \/api\/error-causes[\s\S]*PATCH \/api\/error-causes/)
  assert.match(roadmap, /PATCH \/api\/mistakes\/\{attemptID\}\/cause/)
  assert.match(roadmap, /POST \/api\/mistakes\/\{attemptID\}\/correct/)
  assert.match(roadmap, /订正[\s\S]*答案[\s\S]*用时/)
})

test("schema v18 records restorable six-subject diagnostic evidence", () => {
  assert.match(schema, /evidence_json TEXT NOT NULL DEFAULT '\{\}'/)
  assert.match(databaseSource, /case 18:/)
  assert.match(databaseSource, /ALTER TABLE question_attempts ADD COLUMN evidence_json/)
  assert.match(roadmap, /schema v18[\s\S]*question_attempts[\s\S]*evidence_json/)
  assert.match(roadmap, /PATCH \/api\/mistakes\/\{attemptID\}\/evidence/)
  assert.match(roadmap, /GitHub Pages 静态适配器[\s\S]*同路径、状态码和校验/)
  assert.match(roadmap, /Pages 静态展示[\s\S]*保存相同证据/)
  assert.match(roadmap, /六科诊断总览[\s\S]*首要错因[\s\S]*学科行动建议/)
  assert.doesNotMatch(roadmap, /当前仍缺按错因聚合的诊断视图/)
})

test("the 一节多题 acceptance markers name tests that still exist", () => {
  // ROADMAP 第 3 阶段 marks acceptance items 「已覆盖」 and names what covers them. A
  // marker is only worth reading if the test behind it is still there -- otherwise the
  // document keeps promising coverage the repository no longer has.
  const lessonTests = [
    read("backend/httpapi/lesson_test.go"),
    read("backend/httpapi/lesson_practice_test.go"),
    read("backend/db/lesson_attempt_store_test.go"),
    read("backend/models/lesson_practice_test.go"),
    read("frontend/src/lib/lesson-markdown.test.ts"),
  ].join("\n")

  const covered = [
    // ② 三题各自留一条作答、同一题重答仍是覆盖
    "TestLessonPracticeAttemptsSeparateQuestionsWithinOneSection",
    "TestLessonPracticeAttemptPersistsAndListsNewestFirst",
    // ③ 超过 20 题报 400 且说明上限（含 HTTP 层）
    "TestNormalizeLessonDocumentChecksPracticeQuestions",
    "TestLessonRoutesRefuseAPracticeSectionWithTooManyQuestions",
    // ⑤ Markdown 导出把多题按题号列出
    "prints every question of a section that asks several, numbered",
  ]
  for (const name of covered) {
    assert.match(lessonTests, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${name} is gone; ROADMAP says this is covered`)
  }

  // And the markers themselves stay in the document, with ④ explained rather than
  // silently dropped. `[^；]` rather than `[^\n]`: the list wraps mid-item, so a marker
  // can sit a line below its number.
  for (const marker of ["①", "②", "③", "⑤"]) {
    assert.match(roadmap, new RegExp(`${marker}[^；]*已覆盖`), `acceptance ${marker} lost its 已覆盖 marker`)
  }
  assert.match(roadmap, /④[^；]*不适用/)
})

test("lesson documentation describes the versioned write and preview contract", () => {
  assert.match(roadmap, /POST \/api\/lessons/)
  assert.match(roadmap, /PATCH \/api\/lessons\/{lessonID}/)
  assert.match(roadmap, /POST \/api\/lessons\/{lessonID}\/practice\/{sectionID}\/attempts/)
  assert.match(roadmap, /lesson_attempts[\s\S]*FSRS/)
  assert.match(roadmap, /乐观版本|版本冲突/)
  assert.match(roadmap, /固定十段|十段模板/)
  assert.match(roadmap, /VITE_STATIC_DEMO[\s\S]*GET 预览 fixture[\s\S]*浏览器会话内模拟即时练习证据的 POST\/GET/)
})

test("the 第 4 阶段 gate reads the same numbers in ROADMAP and on screen", () => {
  // The gate is what keeps Task / System Idea from being built to avoid studying. It
  // is only a gate if both the plan and the settings card say the same number -- the
  // two disagreed once already (环节 vs 知识点), which is why this is checked here
  // instead of by reading carefully.
  const gateSource = read("frontend/src/features/settings/PhaseGateNote.tsx")

  const gate = gateSource.match(/const GATE = \{([\s\S]*?)\} as const/)
  assert.ok(gate, "PhaseGateNote.tsx must declare its thresholds as a literal")

  const numbers = {}
  for (const [, key, value] of gate[1].matchAll(/(\w+):\s*(\d+)/g)) {
    numbers[key] = Number(value)
  }
  assert.deepEqual(
    numbers,
    { correctedMistakes: 20, attempts: 30, knowledge: 30 },
    "the on-screen thresholds changed; ROADMAP has to change with them",
  )

  // ROADMAP states the same three, each with where it is read from.
  for (const [label, value] of [
    ["已订正的错题", numbers.correctedMistakes],
    ["复习作答次数", numbers.attempts],
    ["知识点", numbers.knowledge],
  ]) {
    assert.match(
      roadmap,
      new RegExp(`\\|\\s*${label}\\s*\\|\\s*≥\\s*${value}\\s*\\|`),
      `ROADMAP 第 4 阶段 must keep 「${label} ≥ ${value}」 in its gate table`,
    )
  }

  // And each row names an endpoint that exists, so the gate stays computable.
  assert.match(roadmap, /corrected=yes[\s\S]*count/)
  assert.match(roadmap, /dashboard[\s\S]*attempt_count/)
  assert.match(roadmap, /dashboard[\s\S]*knowledge_count/)
})
