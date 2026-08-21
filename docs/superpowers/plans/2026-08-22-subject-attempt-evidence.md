# Subject Attempt Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each subject's diagnostic-board evidence on the corresponding question attempt in the backend and GitHub Pages demo, then restore it in Practice.

**Architecture:** A versioned JSON envelope keeps the transport contract stable while each subject owns its `data` shape. The existing mistake store and static adapter expose a PATCH endpoint; controlled board props let the Practice row edit and save evidence without duplicating diagnostic algorithms.

**Tech Stack:** Go, SQLite, chi, React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Define and test the evidence contract

**Files:**
- Create: `backend/models/subject_evidence_test.go`
- Modify: `backend/db/mistake_store_test.go`
- Modify: `backend/httpapi/mistake_test.go`
- Modify: `frontend/src/api/mistakes.test.ts`
- Modify: `frontend/src/api/static-demo.test.ts`

- [ ] **Step 1: Write failing tests**

Test all seven tools, mismatched subject/tool, malformed JSON, POST persistence, PATCH read-back, and Pages parity.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
go test ./backend/models ./backend/db ./backend/httpapi -run 'Evidence|Mistake'
pnpm --dir frontend exec vitest run src/api/mistakes.test.ts src/api/static-demo.test.ts --pool=forks --maxWorkers=1
```

Expected: compile/assertion failures because the evidence field, migration, and PATCH route do not exist.

### Task 2: Add schema, model validation, and Store support

**Files:**
- Modify: `backend/models/domain.go`
- Create: `backend/models/subject_evidence.go`
- Modify: `backend/db/schema.sql`
- Modify: `backend/db/db.go`
- Modify: `backend/db/mistake_store.go`
- Modify: `backend/db/mistake_store_test.go`

- [ ] **Step 1: Add schema v18 and raw evidence field**

Add `evidence_json TEXT NOT NULL DEFAULT '{}'` to `question_attempts`, migrate v17 databases, and expose `json.RawMessage` on `QuestionAttempt`/`MistakeInput`.

- [ ] **Step 2: Validate the versioned envelope**

Normalize empty input to `{}` and validate version, subject/tool pairing, and each tool's required data types.

- [ ] **Step 3: Persist on create and PATCH**

Store validated evidence transactionally, scan it from list/detail/correction responses, and return `ErrNotFound` for unknown attempts.

- [ ] **Step 4: Run Go focused tests and commit**

```bash
go test ./backend/models ./backend/db -run 'Evidence|Mistake|Schema'
git commit -m "feat: persist subject attempt evidence"
```

### Task 3: Expose HTTP and static Pages parity

**Files:**
- Modify: `backend/httpapi/mistake.go`
- Modify: `backend/httpapi/router.go`
- Modify: `backend/httpapi/mistake_test.go`
- Modify: `frontend/src/api/mistakes.ts`
- Modify: `frontend/src/api/static-demo.ts`
- Modify: `frontend/src/api/mistakes.test.ts`
- Modify: `frontend/src/api/static-demo.test.ts`

- [ ] **Step 1: Register POST field and PATCH route**

Decode `evidence` as JSON, pass it to the Store, and map validation/not-found errors to 400/404.

- [ ] **Step 2: Mirror the route in the static adapter**

Keep the in-memory pair's `attempt.evidence` and return the same response shape.

- [ ] **Step 3: Run focused API tests and commit**

```bash
go test ./backend/httpapi -run 'Evidence|Mistake'
pnpm --dir frontend exec vitest run src/api/mistakes.test.ts src/api/static-demo.test.ts --pool=forks --maxWorkers=1
git commit -m "feat: expose subject evidence contract"
```

### Task 4: Make diagnostic boards controlled and connect Practice

**Files:**
- Modify: `frontend/src/features/chinese/ScoringBoard.tsx`
- Modify: `frontend/src/features/math/DerivationBoard.tsx`
- Modify: `frontend/src/features/english/LongSentenceBoard.tsx`
- Modify: `frontend/src/features/physics/FreeBodyBoard.tsx`
- Modify: `frontend/src/features/physics/MotionBoard.tsx`
- Modify: `frontend/src/features/chemistry/EquationBoard.tsx`
- Modify: `frontend/src/features/geography/ChainBoard.tsx`
- Create: `frontend/src/features/mistake/SubjectEvidenceEditor.tsx`
- Modify: `frontend/src/api/mistakes.ts`
- Modify: `frontend/src/lib/mistakes.ts`
- Modify: `frontend/src/pages/Practice.tsx`
- Modify: corresponding board and `Practice.test.tsx` files

- [ ] **Step 1: Add controlled value/onChange tests**

Each board restores a supplied value and emits its subject data after one edit; the editor selects the correct board for all six subjects and two physics tools.

- [ ] **Step 2: Add PATCH client and row editor**

Open the editor from a mistake row, save the versioned envelope, merge the returned record, and show the saved state without changing the cause or correction controls.

- [ ] **Step 3: Run focused UI tests and commit**

```bash
pnpm --dir frontend exec vitest run src/features/chinese src/features/math src/features/english src/features/physics src/features/chemistry src/features/geography src/features/mistake src/pages/Practice.test.tsx --pool=forks --maxWorkers=1
git commit -m "feat: connect subject boards to mistake evidence"
```

### Task 5: Full verification and roadmap update

**Files:**
- Modify: `ROADMAP.md`
- Modify: `scripts/tests/architecture-docs-consistency.test.mjs`

- [ ] **Step 1: Mark the six-board evidence boundary accurately**

Document that board evidence is persisted and recoverable, while subject-specific grading, task generation, and mastery projection remain future work.

- [ ] **Step 2: Run full checks and Pages build**

```bash
go test -p=1 ./backend/...
pnpm --dir frontend lint
pnpm --dir frontend exec tsc -b --pretty false
pnpm --dir frontend exec vitest run --pool=forks --maxWorkers=2 --reporter=dot
pnpm --dir frontend build
node --test scripts/tests/architecture-docs-consistency.test.mjs scripts/tests/github-pages.test.mjs
```

- [ ] **Step 3: Commit, push, and compare hashes**

```bash
git add ROADMAP.md scripts/tests/architecture-docs-consistency.test.mjs
git commit -m "docs: record six-subject evidence boundary"
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```
