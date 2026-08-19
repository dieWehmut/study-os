# Lesson Practice Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Persist and query deterministic evidence from course immediate-practice answers without changing FSRS memory scheduling.

**Architecture:** Add a `lesson_attempts` table keyed by lesson and document section. The backend loads the canonical lesson section, evaluates structured options locally, and stores the learner answer plus evaluation. The frontend sends submissions through the existing API abstraction; static Pages uses an in-memory adapter with the same response shape.

**Tech Stack:** Go, SQLite migrations, chi HTTP handlers, React/TypeScript, Vitest, Playwright.

---

### Task 1: Persist lesson practice evidence

**Files:**
- Modify: `backend/db/db.go`, `backend/db/schema.sql`
- Modify: `backend/models/domain.go`
- Create: `backend/db/lesson_attempt_store.go`
- Create: `backend/db/lesson_attempt_store_test.go`
- Modify: `ROADMAP.md`, `scripts/tests/architecture-docs-consistency.test.mjs`

- [ ] Add schema v14 with `lesson_attempts(id, lesson_id, section_id, answer, evaluation, reference_answer, feedback, elapsed_ms, created_at)` and lesson index.
- [ ] Add `models.LessonPracticeAttempt` and validation for non-empty IDs, `elapsed_ms >= 0`, and evaluation values `correct|incorrect|ungraded`.
- [ ] Add store create/list methods. Creation must verify the lesson exists and use a transaction-safe generated ID supplied by the HTTP layer.
- [ ] Write failing store/migration tests, run `go test ./backend/db -run LessonPractice`, then implement until green.
- [ ] Update the roadmap schema head and architecture contract, run `node --test scripts/tests/architecture-docs-consistency.test.mjs`, and commit only this task.

### Task 2: Expose deterministic practice endpoints

**Files:**
- Create: `backend/httpapi/lesson_practice.go`
- Modify: `backend/httpapi/router.go`
- Create: `backend/httpapi/lesson_practice_test.go`

- [ ] Add failing route tests for correct, incorrect, ungraded, list ordering, missing lesson/section, empty answer, and negative elapsed time.
- [ ] Parse a section's structured content (`question`, `options`, `correct_answer`, `explanation`) from the canonical lesson document.
- [ ] Compare trimmed answers case-insensitively; return `evaluation`, `reference_answer`, and feedback while persisting the same values.
- [ ] Map validation/not-found errors to 400/404 and storage failures to 500; return 201 for creation and 200 for list.
- [ ] Run focused HTTP tests, `go test -p=1 ./backend/...`, and `go vet ./backend/...`; commit this task.

### Task 3: Keep static Pages behavior equivalent

**Files:**
- Modify: `frontend/src/api/static-demo.ts`, `frontend/src/api/static-demo.test.ts`
- Modify: `frontend/src/api/lessons.ts` or create `frontend/src/api/lesson-practice.ts`

- [ ] Add a shared response type and API helper for submit/list.
- [ ] Add in-memory `lessonAttempts` state and POST/GET routes with the same evaluation rules and validation messages.
- [ ] Write red Vitest tests proving correct/incorrect/ungraded submissions persist in static mode and no network is used.
- [ ] Run focused Vitest, ESLint, and TypeScript; commit this task.

### Task 4: Connect the practice UI

**Files:**
- Modify: `frontend/src/components/lessons/LessonPractice.tsx`
- Modify: `frontend/src/pages/LessonDetail.tsx`
- Modify: `frontend/src/components/lessons/LessonPractice.test.tsx`, `frontend/src/pages/LessonDetail.test.tsx`
- Modify: `frontend/e2e-pages/static-showcase.spec.ts`

- [ ] Pass lesson ID into the practice component and submit through the helper while retaining immediate optimistic feedback.
- [ ] Show a small saved-evidence state and keep the answer/feedback visible if persistence fails.
- [ ] Add tests for static submission and backend error fallback; extend Pages smoke to submit the fixture question and assert the saved state.
- [ ] Run focused Vitest, full frontend lint/tsc/build, artifact checks, and preview smoke; commit this task.

### Task 5: Integrate and push

- [ ] Review each commit for unrelated files and confirm `k.json` is untracked only.
- [ ] Run `go test -p=1 ./...`, `go vet ./backend/...`, frontend contract tests, and `git diff --check`.
- [ ] Push `main`, verify `git ls-remote`, and monitor the Pages workflow.
