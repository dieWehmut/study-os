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
  ]) {
    assert.match(schema, tablePattern(table), `schema is missing ${table}`)
    assert.match(roadmap, new RegExp(`\\b${table}\\b`), `ROADMAP is missing ${table}`)
  }

  assert.match(roadmap, /题目 Question\s*\|\s*✅/)
  assert.match(roadmap, /错因 Error Cause\s*\|\s*🟡/)
  assert.match(roadmap, /课程 Lesson\s*\|\s*🟡/)
  assert.match(roadmap, /\/api\/mistakes/)
  assert.doesNotMatch(roadmap, /题目 Question\s*\|\s*❌/)
  assert.doesNotMatch(roadmap, /错因 Error Cause\s*\|\s*❌/)
  assert.doesNotMatch(roadmap, /课程 Lesson\s*\|\s*❌/)
})

test("ROADMAP records question-attempt evidence at the schema head", () => {
  assert.match(schema, /answer TEXT NOT NULL DEFAULT ''/)
  assert.match(schema, /elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK \(elapsed_ms >= 0\)/)
  assert.match(schema, /is_correct INTEGER NOT NULL DEFAULT 0 CHECK \(is_correct IN \(0, 1\)\)/)
  assert.match(databaseSource, /case 15:/)
  assert.match(databaseSource, /ALTER TABLE question_attempts ADD COLUMN answer/)
  assert.match(roadmap, /schema v15[\s\S]*question_attempts[\s\S]*answer[\s\S]*elapsed_ms[\s\S]*is_correct/)
  assert.match(roadmap, /POST \/api\/mistakes\/\{attemptID\}\/correct/)
  assert.match(roadmap, /订正[\s\S]*答案[\s\S]*用时/)
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
