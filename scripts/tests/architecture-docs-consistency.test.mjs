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
  assert.match(roadmap, /显式回流[\s\S]*不做未经用户确认的自动写入/)
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

test("lesson documentation describes the versioned write and preview contract", () => {
  assert.match(roadmap, /POST \/api\/lessons/)
  assert.match(roadmap, /PATCH \/api\/lessons\/{lessonID}/)
  assert.match(roadmap, /POST \/api\/lessons\/{lessonID}\/practice\/{sectionID}\/attempts/)
  assert.match(roadmap, /lesson_attempts[\s\S]*FSRS/)
  assert.match(roadmap, /乐观版本|版本冲突/)
  assert.match(roadmap, /固定十段|十段模板/)
  assert.match(roadmap, /VITE_STATIC_DEMO[\s\S]*GET 预览 fixture[\s\S]*浏览器会话内模拟即时练习证据的 POST\/GET/)
})
