# Structured Q&A Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and edit one structured learning-evidence record per chat conversation in both the local backend and GitHub Pages demo.

**Architecture:** Keep immutable chat messages as the transcript and add a separate `qa_records` projection keyed by `session_id`. Expose idempotent GET/PUT endpoints, mirror them in the static adapter, and render a focused single-column panel that prefills from the latest completed turn.

**Tech Stack:** Go, SQLite, chi, React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Q&A record model and SQLite persistence

**Files:**
- Modify: `backend/models/domain.go`
- Modify: `backend/db/schema.sql`
- Modify: `backend/db/db.go`
- Create: `backend/db/qa_record_store.go`
- Create: `backend/db/qa_record_store_test.go`

- [ ] **Step 1: Write failing model/store tests**

Test that a valid record is created, the same `session_id` updates in place while preserving `id` and `created_at`, reopening the database retains it, and invalid status/context is rejected.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `go test ./backend/db ./backend/models -run 'QARecord|Schema'`

Expected: compilation or assertion failure because `QARecord`, schema v17, and store methods do not exist.

- [ ] **Step 3: Implement the model and migration**

Add `QARecord`, `QARecordStatusOpen`, `QARecordStatusUnderstood`, `QARecordStatusFollowUp`, allowed context types, and `Validate()`. Add `qa_records` to `schema.sql`, migration `case 17`, `currentSchemaVersion = 17`, and v17 verification.

- [ ] **Step 4: Implement store methods**

Add:

```go
func (s *Store) GetQARecord(ctx context.Context, sessionID string) (models.QARecord, error)
func (s *Store) UpsertQARecord(ctx context.Context, record models.QARecord) (models.QARecord, error)
```

Validate that the chat session exists and that optional context targets exist in `knowledge_items`, `questions`, or `lessons` before writing.

- [ ] **Step 5: Run focused tests and commit**

Run: `go test ./backend/db ./backend/models -run 'QARecord|Schema'`

Commit: `feat: persist structured qa records`

### Task 2: HTTP and frontend API contracts

**Files:**
- Create: `backend/httpapi/chat_records.go`
- Create: `backend/httpapi/chat_records_test.go`
- Modify: `backend/httpapi/router.go`
- Modify: `frontend/src/api/chat.ts`
- Modify: `frontend/src/api/chat.test.ts`

- [ ] **Step 1: Write failing HTTP and client tests**

Cover GET 404, PUT create, PUT update, invalid status, invalid context, `getQARecord()` returning `null` on 404, and `saveQARecord()` sending the canonical payload.

- [ ] **Step 2: Run tests and verify RED**

Run: `go test ./backend/httpapi -run QARecord`

Run: `pnpm --dir frontend exec vitest run src/api/chat.test.ts --pool=forks --maxWorkers=1`

- [ ] **Step 3: Implement endpoints and client wrappers**

Register:

```text
GET /api/chat/records/{sessionID}
PUT /api/chat/records/{sessionID}
```

Implement typed `QARecord`, `QARecordInput`, `getQARecord(sessionID)`, and `saveQARecord(sessionID, input)` in the frontend API.

- [ ] **Step 4: Run focused tests and commit**

Commit: `feat: expose structured qa record api`

### Task 3: GitHub Pages static contract

**Files:**
- Modify: `frontend/src/api/static-demo.ts`
- Modify: `frontend/src/api/static-demo.test.ts`

- [ ] **Step 1: Write a failing Pages test**

Save a record through `/chat/records/session-id`, read it back, update it, and assert the stable `id` plus changed `updated_at`/fields.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir frontend exec vitest run src/api/static-demo.test.ts --pool=forks --maxWorkers=1`

- [ ] **Step 3: Add static state and GET/PUT routing**

Store records in an in-memory map keyed by `session_id`, validate status and context pairing, and keep the same response shape as the Go API.

- [ ] **Step 4: Run the focused test and commit**

Commit: `feat: mirror qa records in static demo`

### Task 4: Single-column Q&A evidence panel

**Files:**
- Create: `frontend/src/features/chat/QARecordPanel.tsx`
- Create: `frontend/src/features/chat/QARecordPanel.test.tsx`
- Modify: `frontend/src/pages/Chat.tsx`
- Modify: `frontend/src/pages/Chat.test.tsx`

- [ ] **Step 1: Write failing component/page tests**

Assert that the panel appears only for a completed conversation, prefills the latest user/assistant turn, loads an existing record, keeps every field in one column, saves edits, and preserves the draft on failure.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir frontend exec vitest run src/features/chat/QARecordPanel.test.tsx src/pages/Chat.test.tsx --pool=forks --maxWorkers=1`

- [ ] **Step 3: Implement the focused component**

Render one field per row for context, original understanding, corrected model, mastery evidence, unresolved points, and status. Reuse `listKnowledge`, `listMistakes`, and `listLessons` to build human-readable context options.

- [ ] **Step 4: Integrate with Chat and commit**

Commit: `feat: capture qa mastery evidence`

### Task 5: Documentation and full verification

**Files:**
- Modify: `ROADMAP.md`
- Modify: `scripts/tests/architecture-docs-consistency.test.mjs`

- [ ] **Step 1: Update the architecture contract for schema v17**

Document `qa_records`, the GET/PUT endpoints, and mark Q&A as persisted structured evidence while noting that automatic downstream task/memory generation remains future work.

- [ ] **Step 2: Run verification**

Run:

```text
go test -p=1 ./backend/...
go vet ./...
pnpm --dir frontend exec vitest run --pool=forks --maxWorkers=2 --reporter=dot
pnpm --dir frontend lint
pnpm --dir frontend exec tsc -b --pretty false
node --test scripts/tests/architecture-docs-consistency.test.mjs scripts/tests/github-pages.test.mjs
```

- [ ] **Step 3: Build GitHub Pages and commit**

Run with `VITE_STATIC_DEMO=true` and `VITE_BASE_PATH=/study-os/`:

`pnpm --dir frontend build`

Commit: `docs: document structured qa evidence`

- [ ] **Step 4: Push and verify remote**

Push each task commit to `origin/main`, then compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/main`.

