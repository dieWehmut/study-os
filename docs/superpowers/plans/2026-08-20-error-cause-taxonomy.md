# Error Cause Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist an extensible, subject-aware mistake-cause taxonomy and make Practice use it without losing historical free-text mistakes.

**Architecture:** Schema v16 introduces an `error_causes` table seeded with the existing six IDs. Store and HTTP layers own validation, confirmation, reclassification, and the `review_fixes` decision; the frontend consumes confirmed categories and retains a conservative compatibility fallback. GitHub Pages mirrors the API in memory.

**Tech Stack:** Go 1.24, SQLite, chi HTTP, React 19, TypeScript, Vite, Vitest, Playwright.

---

### Task 1: Persist Error Cause Definitions

**Files:**
- Modify: `backend/models/domain.go`
- Modify: `backend/db/schema.sql`
- Modify: `backend/db/db.go`
- Create: `backend/db/error_cause_store.go`
- Create: `backend/db/error_cause_store_test.go`

- [ ] **Step 1: Write failing model/store/migration tests**

Cover fresh-store default seeds, v15 migration, subject-scoped listing,
candidate creation, confirmation, duplicate IDs, wrong-scope parents,
reclassification, and persisted review-fixability.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `go test -p=1 ./backend/db -run ErrorCause -count=1`

Expected: compile failures for the missing `models.ErrorCause` and Store APIs.

- [ ] **Step 3: Implement the minimal schema and store**

Add schema v16, idempotent default inserts, model validation, scan helpers, CRUD,
scope/status filtering, mistake reclassification, and review-fixability lookup.

- [ ] **Step 4: Run focused and backend verification**

Run: `go test -p=1 ./backend/db -run ErrorCause -count=1`

Run: `go test -p=1 ./backend/...`

- [ ] **Step 5: Commit**

Commit the red test separately, then the green implementation. Push only after
the implementation commit keeps `main` green.

### Task 2: Expose the Taxonomy API

**Files:**
- Create: `backend/httpapi/error_cause.go`
- Create: `backend/httpapi/error_cause_test.go`
- Modify: `backend/httpapi/router.go`
- Modify: `backend/httpapi/mistake_schedule.go`

- [ ] **Step 1: Write failing HTTP tests**

Cover confirmed listing, candidate creation, confirmation, duplicate conflict,
invalid status, successful reclassification, wrong-subject rejection, and
dynamic schedule permission.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `go test -p=1 ./backend/httpapi -run ErrorCause -count=1`

Expected: 404 responses because the routes are not registered.

- [ ] **Step 3: Implement handlers and route registration**

Map invalid input to 400, missing rows to 404, duplicates to 409, and replace
the hardcoded scheduling guard with the persisted category decision.

- [ ] **Step 4: Verify HTTP and backend packages**

Run: `go test -p=1 ./backend/httpapi -run 'ErrorCause|MistakeSchedule' -count=1`

Run: `go test -p=1 ./backend/...`

- [ ] **Step 5: Commit and push the green batch**

### Task 3: Add Frontend API and Static Adapter

**Files:**
- Create: `frontend/src/api/error-causes.ts`
- Create: `frontend/src/api/error-causes.test.ts`
- Modify: `frontend/src/api/static-demo.ts`
- Modify: `frontend/src/api/static-demo.test.ts`
- Modify: `frontend/src/api/mistakes.ts`
- Modify: `frontend/src/api/mistakes.test.ts`

- [ ] **Step 1: Write failing API/static tests**

Cover confirmed subject scope, candidate lifecycle, reclassification, URL
encoding, and preservation of an unknown free-text mistake.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir frontend exec vitest run src/api/error-causes.test.ts src/api/mistakes.test.ts src/api/static-demo.test.ts --pool=forks --maxWorkers=1`

- [ ] **Step 3: Implement API types and static routes**

Keep `MistakeCause` string-based, generate a conservative fallback spec for an
unknown cause, and mirror backend validation in the static adapter.

- [ ] **Step 4: Verify focused tests, ESLint, and TypeScript**

Run the focused Vitest command, `pnpm --dir frontend lint`, and
`pnpm --dir frontend exec tsc -b --pretty false`.

- [ ] **Step 5: Commit and push the green batch**

### Task 4: Make Practice Taxonomy-Driven

**Files:**
- Modify: `frontend/src/lib/mistakes.ts`
- Modify: `frontend/src/lib/mistakes.test.ts`
- Modify: `frontend/src/pages/Practice.tsx`
- Modify: `frontend/src/pages/Practice.test.tsx`

- [ ] **Step 1: Write failing rendering and summary tests**

Cover a subject-specific confirmed cause in capture buttons, summary counts,
persisted action text, conservative free-text rendering, and fallback to the
legacy six when taxonomy loading fails.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir frontend exec vitest run src/lib/mistakes.test.ts src/pages/Practice.test.tsx --pool=forks --maxWorkers=1`

- [ ] **Step 3: Implement taxonomy state and dynamic summaries**

Load causes with mistakes on subject change, pass specs into summary helpers,
and leave subject drawing boards as optional enhancements for known legacy IDs.

- [ ] **Step 4: Verify focused and full frontend gates**

Run focused Vitest, full Vitest, ESLint, and TypeScript compilation.

- [ ] **Step 5: Commit and push the green batch**

### Task 5: Record the Architecture and Pages Contract

**Files:**
- Modify: `ROADMAP.md`
- Modify: `scripts/tests/architecture-docs-consistency.test.mjs`
- Modify: `frontend/e2e-pages/static-showcase.spec.ts`

- [ ] **Step 1: Write failing architecture and Pages assertions**

Require schema v16, `error_causes`, subject-scoped taxonomy language, and one
static Practice path that files or displays a subject-specific category without
making `/api` network requests.

- [ ] **Step 2: Update ROADMAP and Pages interaction**

Describe the persisted object, candidate/confirmed boundary, free-text
compatibility, reclassification endpoint, and remaining analytics work.

- [ ] **Step 3: Run full verification**

Run `go test -p=1 ./...`, `go vet ./...`, full frontend Vitest, ESLint,
TypeScript, static build, Pages contract tests, architecture contract tests,
and the built-artifact Playwright smoke.

- [ ] **Step 4: Commit and push**

Push `main`, verify `git ls-remote origin refs/heads/main` equals local HEAD,
and leave `k.json` untracked.
