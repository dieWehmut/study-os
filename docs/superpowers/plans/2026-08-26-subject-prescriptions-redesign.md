# Six-Subject Prescriptions Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Chinese, Math, English, Physics, Chemistry, and Geography distinct, actionable diagnosis and remediation paths while preserving backend and GitHub Pages parity.

**Architecture:** A pure subject-prescription registry owns learning focus, actions, evidence, next step, and subject/cause tool guidance. Small React components render the registry; existing evidence boards remain isolated and persist through the current versioned evidence contract.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Go, SQLite, GitHub Pages static adapter.

---

### Task 1: Capture the 0826 source and approve the implementation boundary

**Files:**
- Modify: `prompt/0826.md`
- Create: `docs/superpowers/specs/2026-08-26-subject-prescriptions-redesign.md`
- Create: `docs/superpowers/plans/2026-08-26-subject-prescriptions-redesign.md`

- [ ] **Step 1: Preserve the image transcription**

Record all three image paragraphs verbatim, retain the pre-existing reading-speed note, and separate source text from interpretation.

- [ ] **Step 2: Define four independently shippable phases**

Document the six-subject prescription layer, English question matrix, controlled math geometry protocol, and source-backed whiteboard research/workbench.

- [ ] **Step 3: Verify the documents**

Run:

```powershell
rg -n "Heptbase|单词/短语|解三角形|六个学科真正对症下药" prompt/0826.md
rg -n "方案 B|Pages|后续边界" docs/superpowers/specs/2026-08-26-subject-prescriptions-redesign.md
```

Expected: every required source phrase and design boundary is present.

- [ ] **Step 4: Commit**

```powershell
git add prompt/0826.md docs/superpowers/specs/2026-08-26-subject-prescriptions-redesign.md docs/superpowers/plans/2026-08-26-subject-prescriptions-redesign.md
git commit -m "docs: define 0826 subject redesign"
git push origin main
```

### Task 2: Add the tested subject-prescription registry

**Files:**
- Create: `frontend/src/lib/subject-prescriptions.test.ts`
- Create: `frontend/src/lib/subject-prescriptions.ts`

- [ ] **Step 1: Write a failing registry test**

Assert that the six canonical IDs each return a distinct prescription with non-empty focus, two or more actions, evidence, next step, and only known evidence-tool IDs. Assert an unknown ID returns `undefined`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm --dir frontend exec vitest run src/lib/subject-prescriptions.test.ts --pool=forks --maxWorkers=1
```

Expected: FAIL because `subject-prescriptions.ts` does not exist.

- [ ] **Step 3: Implement the registry**

Export `SUBJECT_PRESCRIPTIONS`, `prescriptionFor`, and `guidanceFor`. Keep the registry data-only and reuse canonical IDs from `subjects.ts`.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
pnpm --dir frontend exec vitest run src/lib/subject-prescriptions.test.ts --pool=forks --maxWorkers=1
git add frontend/src/lib/subject-prescriptions.ts frontend/src/lib/subject-prescriptions.test.ts
git commit -m "feat: define six-subject learning prescriptions"
git push origin main
```

### Task 3: Render prescriptions in Practice

**Files:**
- Create: `frontend/src/features/subjects/SubjectPrescriptionPanel.test.tsx`
- Create: `frontend/src/features/subjects/SubjectPrescriptionPanel.tsx`
- Modify: `frontend/src/pages/Practice.test.tsx`
- Modify: `frontend/src/pages/Practice.tsx`

- [ ] **Step 1: Write failing component and page tests**

Cover six compact cards for `all`, full Math content for `math`, an accessible subject-selection action, and Practice updating the panel after a subject choice.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --dir frontend exec vitest run src/features/subjects/SubjectPrescriptionPanel.test.tsx src/pages/Practice.test.tsx --pool=forks --maxWorkers=1
```

Expected: FAIL because the panel is missing.

- [ ] **Step 3: Implement the panel and integrate it**

Render compact all-subject cards and a detailed single-subject card. Keep API calls, mistake state, and evidence editors in `Practice`; only move stable instructional copy into the registry.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
pnpm --dir frontend exec vitest run src/features/subjects/SubjectPrescriptionPanel.test.tsx src/pages/Practice.test.tsx --pool=forks --maxWorkers=1
git add frontend/src/features/subjects/SubjectPrescriptionPanel.tsx frontend/src/features/subjects/SubjectPrescriptionPanel.test.tsx frontend/src/pages/Practice.tsx frontend/src/pages/Practice.test.tsx
git commit -m "feat: show subject-specific practice prescriptions"
git push origin main
```

### Task 4: Unify cause guidance and evidence-tool routing

**Files:**
- Modify: `frontend/src/lib/mistakes.test.ts`
- Modify: `frontend/src/lib/mistakes.ts`
- Create: `frontend/src/features/mistake/subject-evidence.test.ts`
- Modify: `frontend/src/features/mistake/subject-evidence.ts`
- Modify: `frontend/src/pages/Practice.tsx`

- [ ] **Step 1: Write failing routing tests**

Assert representative cause pairs choose different subject actions and tools: Chinese method/scoring points, Math method/derivation, English method/long sentence, Physics method/free body and misread/motion, Chemistry careless/equation, Geography method/causal chain.

- [ ] **Step 2: Verify RED**

Temporarily assert that the registry is the source of these values; the existing duplicated tables must fail this identity/source-boundary assertion.

- [ ] **Step 3: Delegate to the registry**

Make `causeActionFor` and `subjectEvidenceToolFor` consult `guidanceFor`, then use taxonomy fallback when no subject override exists. Remove duplicated subject/cause strings from `Practice` where the registry provides them.

- [ ] **Step 4: Verify and commit**

```powershell
pnpm --dir frontend exec vitest run src/lib/mistakes.test.ts src/features/mistake/subject-evidence.test.ts src/pages/Practice.test.tsx --pool=forks --maxWorkers=1
git add frontend/src/lib/mistakes.ts frontend/src/lib/mistakes.test.ts frontend/src/features/mistake/subject-evidence.ts frontend/src/features/mistake/subject-evidence.test.ts frontend/src/pages/Practice.tsx
git commit -m "refactor: route remediation through subject prescriptions"
git push origin main
```

### Task 5: Ensure six-subject Pages fixtures and complete verification

**Files:**
- Modify: `frontend/src/api/static-demo.test.ts`
- Modify: `frontend/src/api/static-demo.ts`
- Modify: `ROADMAP.md`
- Modify: `scripts/tests/architecture-docs-consistency.test.mjs`

- [ ] **Step 1: Write a failing Pages fixture test**

List mistakes in static mode and assert every canonical subject has at least one fixture whose cause has either a prescription action or evidence tool.

- [ ] **Step 2: Verify RED, then add only missing fixtures**

Run the static adapter test and add deterministic browser-memory fixtures without making network requests.

- [ ] **Step 3: Run fresh full verification**

```powershell
go test -p=1 ./backend/...
pnpm --dir frontend lint
pnpm --dir frontend exec tsc -b --pretty false
pnpm --dir frontend exec vitest run --pool=forks --maxWorkers=2 --reporter=dot
pnpm --dir frontend build
node --test scripts/tests/architecture-docs-consistency.test.mjs scripts/tests/github-pages.test.mjs
```

Expected: all commands exit 0 with no failing tests.

- [ ] **Step 4: Commit, push, and compare local/remote heads**

```powershell
git add frontend/src/api/static-demo.ts frontend/src/api/static-demo.test.ts ROADMAP.md scripts/tests/architecture-docs-consistency.test.mjs
git commit -m "docs: record six-subject prescription boundary"
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: local and remote commit hashes match.
