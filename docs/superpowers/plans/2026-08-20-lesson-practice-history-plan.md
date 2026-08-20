# Lesson Practice History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the existing lesson practice attempts GET endpoint so a course practice card shows its saved count and latest result when reopened.

**Architecture:** Keep persistence and grading unchanged. The `LessonPractice` component owns a small history state and calls the existing API helper only when `lessonID` is supplied; the static adapter already provides the same route in memory. The latest history entry is converted to the existing `PracticeResult` shape and remains secondary to a new submission.

**Tech Stack:** React 19, TypeScript, Testing Library/Vitest, Playwright, existing `lesson-practice` API helper.

---

### Task 1: Lock the history API/component contract

**Files:**
- Modify: `frontend/src/components/lessons/LessonPractice.test.tsx`
- Modify: `frontend/src/pages/LessonDetail.test.tsx`

- [ ] **Step 1: Add a mocked GET helper and a failing history test.**
  Extend the existing `@/api/lesson-practice` mock with `listLessonPracticeAttempts`. Render `LessonPractice` with `lessonID`, resolve one `incorrect` attempt, and assert the initial card eventually contains `已作答 1 次` and `参考答案：...` before any submit.
- [ ] **Step 2: Add failure-degradation coverage.**
  Reject `listLessonPracticeAttempts`, render with a lesson ID, and assert `data-practice-history="error"`, while the radio and submit button remain usable.
- [ ] **Step 3: Run the focused tests and confirm red.**
  Run `pnpm exec vitest run src/components/lessons/LessonPractice.test.tsx src/pages/LessonDetail.test.tsx --pool=forks --maxWorkers=1`; expected failure is missing history text/attribute.
- [ ] **Step 4: Commit the red tests only.**
  Run `git add frontend/src/components/lessons/LessonPractice.test.tsx frontend/src/pages/LessonDetail.test.tsx` and commit `test: define lesson practice history contract`.

### Task 2: Implement component history loading

**Files:**
- Modify: `frontend/src/components/lessons/LessonPractice.tsx`

- [ ] **Step 1: Add typed local state and loader.**
  Import `listLessonPracticeAttempts` and add `historyState`, `historyCount`, and `latestAttempt` state. In an effect keyed by `lessonID` and `section.id`, set `loading`, call the helper, retain the first item, and catch into `error`; skip the effect when no lesson ID.
- [ ] **Step 2: Convert the latest attempt without changing submit behavior.**
  Before a new submission, derive `resultFromAttempt(latestAttempt)` and render it only when `submitted` is false. Keep the existing optimistic result and evidence save states unchanged after submit.
- [ ] **Step 3: Add compact status UI.**
  Add `data-practice-history={historyState}` to the interactive article. When ready and count > 0, render `已作答 {count} 次` plus latest elapsed time/result; when loading render a muted `正在读取练习记录…`. Do not render a full log.
- [ ] **Step 4: Run focused tests and lint.**
  Run the Vitest command from Task 1, `pnpm exec eslint src/components/lessons/LessonPractice.tsx src/components/lessons/LessonPractice.test.tsx`, and `pnpm exec tsc -b --pretty false`; expected all pass.
- [ ] **Step 5: Commit the component slice.**
  Run `git add frontend/src/components/lessons/LessonPractice.tsx frontend/src/components/lessons/LessonPractice.test.tsx frontend/src/pages/LessonDetail.test.tsx` and commit `feat: show saved lesson practice history`.

### Task 3: Verify the static Pages session flow

**Files:**
- Modify: `frontend/e2e-pages/static-showcase.spec.ts`

- [ ] **Step 1: Extend the smoke test.**
  After submitting Newton's question and asserting `已保存答题证据`, navigate to `#/lessons`, return to `#/lessons/lesson-newton`, and assert the practice card contains `已作答 1 次` and the saved result; keep the existing no-`/api` and no-runtime-error assertions.
- [ ] **Step 2: Run the built preview smoke.**
  Set `VITE_STATIC_DEMO=true`, `VITE_BASE_PATH=/study-os/`, and `PAGES_PREVIEW=true`, then run `pnpm exec playwright test --config playwright.pages.config.ts`; expected 1 passed.
- [ ] **Step 3: Commit the E2E slice.**
  Run `git add frontend/e2e-pages/static-showcase.spec.ts` and commit `test: cover lesson practice history on Pages`.

### Task 4: Full verification and push

- [ ] **Step 1: Run frontend and backend gates.**
  Run `go test -p=1 ./...`, `go vet ./...`, `pnpm exec vitest run --pool=forks --maxWorkers=1 --reporter=dot`, `pnpm lint`, and `pnpm exec tsc -b --pretty false`.
- [ ] **Step 2: Run Pages contracts.**
  Build with `VITE_STATIC_DEMO=true VITE_BASE_PATH=/study-os/`, then run `node scripts/tests/github-pages.test.mjs`, `node scripts/tests/github-pages-artifact.test.mjs`, and `node --test scripts/tests/architecture-docs-consistency.test.mjs`.
- [ ] **Step 3: Push and verify.**
  Run `git diff --check`, confirm only `k.json` is untracked, push `git push origin main`, and verify `git ls-remote origin refs/heads/main` matches `git rev-parse HEAD`.
