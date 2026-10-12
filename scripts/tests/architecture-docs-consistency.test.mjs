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

test("撤与不撤：计划有撤销路由，证据没有被删除的路由", () => {
  // ROADMAP 第八节的判据是「撤之前先问抹掉的是打算还是发生过的事」。判据只有能被检查才算数：
  // 计划（排进复习）必须有撤销路由；证据（订正写的是一条作答）**不该**有删除路由。
  const router = read("backend/httpapi/router.go")
  assert.match(router, /api\.Delete\("\/knowledge\/\{knowledgeID\}\/schedule"/, "计划应该能撤：缺少取消排复习的路由")

  // 订正不是开关，是一条作答（corrected 由 EXISTS(question_attempts WHERE is_correct=1) 推导）。
  // 给它加"撤销"就是加"删证据"，所以这条路由必须一直不存在。
  assert.doesNotMatch(router, /api\.Delete\(\s*"\/mistakes\/\{[^}]+\}\/correct"/, "订正是证据，不该有删除路由")

  // 同理：练习作答也没有"删掉那次作答"的路由。
  assert.doesNotMatch(router, /api\.Delete\(\s*"\/lessons\/[^"]*practice[^"]*"/, "练习作答是证据，不该有删除路由")
})
test("归档 只写标记，不删任何行（§8.1 验收 ④）", () => {
  // 归档 的意义是"藏起来"，不是"抹掉"：被作答过的条目根本删不掉（外键 RESTRICT），
  // 而删掉它就会连证据一起毁。所以这条检查守两件事：
  //   ① 归档的 store 方法只 UPDATE，不含 DELETE；
  //   ② 没有"删除知识条目"的路由 —— 这条是**反向**的：它守"某样东西必须一直不在"。
  const store = read("backend/db/store.go")
  const archiveFn = /func \(s \*Store\) SetKnowledgeArchived[\s\S]*?\n}/.exec(store)
  assert.ok(archiveFn, "SetKnowledgeArchived 不在了")
  assert.match(archiveFn[0], /UPDATE knowledge_items SET/, "归档应该是 UPDATE")
  assert.doesNotMatch(archiveFn[0], /DELETE FROM/, "归档不许删行")

  const router = read("backend/httpapi/router.go")
  // 归档的两个方向都在。
  assert.match(router, /api\.Post\("\/knowledge\/\{knowledgeID\}\/archive"/, "缺少归档路由")
  assert.match(router, /api\.Delete\("\/knowledge\/\{knowledgeID\}\/archive"/, "缺少取消归档路由")
  // 而知识条目本身**没有**删除路由：§8.1 的「明确不做」。
  assert.doesNotMatch(router, /api\.Delete\("\/knowledge\/\{knowledgeID\}"\s*,/, "知识条目不该有删除路由")
})
test("§8.1 的归档已落地：文档说法与代码一致", () => {
  // 这一节从"形状"变成"已实现"花了 231-241 轮，而文档一度还挂着「未实现」。
  // 过时的说明读起来和错的一模一样（§七），所以把它绑在代码上：方法在 ⇒ 文档不许再说未实现。
  const store = read("backend/db/store.go")
  assert.match(store, /func \(s \*Store\) SetKnowledgeArchived/, "归档的 store 方法不在了")
  assert.match(roadmap, /8\.1[^\n]*已实现/, "§8.1 没说清它已实现")
  assert.doesNotMatch(roadmap, /8\.1[^\n]*未实现/, "§8.1 仍写着未实现，而它已经落地")
  // 反向那条也要在：归档不许退化成删除。
  const router = read("backend/httpapi/router.go")
  assert.doesNotMatch(router, /api\.Delete\("\/knowledge\/\{knowledgeID\}"\s*,/, "知识条目不该有删除路由")
})
test("ROADMAP 开头的索引与它自己的小节一一对应", () => {
  // 这张索引是"这份文件有哪几节"的答案，而它自己被改过三次：194 轮建立、195 轮加第八节、
  // 300 轮加第九节——每次漏掉都会让索引变成漂移源（§七 那条规矩）。所以让机器记着：
  // 小节标题与索引行必须一一对应，多一个少一个都不行。
  const numerals = "一二三四五六七八九十"
  const headings = [...roadmap.matchAll(new RegExp(`^## ([${numerals}]+)、`, "gm"))].map((m) => m[1])
  const indexed = [...roadmap.matchAll(new RegExp(`^\\| ([${numerals}]+)、`, "gm"))].map((m) => m[1])
  assert.ok(headings.length >= 9, `ROADMAP 只找到 ${headings.length} 个小节`)
  assert.deepEqual(
    [...new Set(indexed)].sort(),
    [...new Set(headings)].sort(),
    "索引行与小节标题对不上：索引是这份文件的地图，地图错了比没有地图更糟",
  )
})
test("§一 的对象盘点表与它自己宣称的 13 个对象一一对应", () => {
  // 标题说"0801 的 13 个底层对象"，表格就该恰好 13 行、编号 1..13。§四 的学科表重新从 1 编号，
  // 所以只看 §一 这一节——一张表错了，另一张表不该替它背锅。
  const section = /^## 一、[\s\S]*?(?=^## )/m.exec(roadmap)
  assert.ok(section, "找不到 §一 这一节")
  assert.match(section[0], /13 个底层对象/, "§一 不再宣称 13 个对象")
  const numbers = [...section[0].matchAll(/^\| (\d+) \|/gm)].map((match) => Number(match[1]))
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], `§一 的表格编号是 ${numbers.join(",")}`)
})
test("恢复模式筛的题型，界面上都有名字", () => {
  // 恢复模式 is a prompt-type filter (db/store.go), and the card side names those types
  // (ReviewSession.tsx). If a type is admitted and has no name, the reader gets a card whose
  // kind the UI cannot say -- and nothing else would notice.
  const store = read("backend/db/store.go")
  const filter = /"recovery"\)\s*\{[\s\S]{0,220}?IN \(([^)]*)\)/.exec(store)
  assert.ok(filter, "找不到恢复模式筛的题型")
  const types = filter[1].split(",").map((part) => part.trim().replace(/'/g, ""))
  assert.ok(types.length > 0, "恢复模式一个题型都没筛")

  const session = read("frontend/src/features/memory/ReviewSession.tsx")
  const labels = types.map((type) => {
    const found = new RegExp(`^\\s*${type}:\\s*"([^"]+)"`, "m").exec(session)
    assert.ok(found, `${type} 在界面上没有名字`)
    return found[1]
  })

  // And the sentence that explains the toggle has to name them too. Prose cannot be bound
  // exactly, but it can be required to mention every label -- otherwise adding a third type
  // would leave the copy quietly describing a queue that no longer exists.
  const memory = read("frontend/src/pages/Memory.tsx")
  for (const label of labels) {
    const loose = label.replace(/,/g, "[，,]").replace(/，/g, "[，,]")
    assert.match(memory, new RegExp(loose), `恢复模式的说明里没提「${label}」`)
  }
})