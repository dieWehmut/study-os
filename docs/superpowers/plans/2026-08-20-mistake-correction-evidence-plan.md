# Mistake Correction Evidence Implementation Plan

**Goal:** Persist the learner's correction answer and elapsed time so a corrected mistake carries observable evidence instead of a boolean-only click.

**Architecture:** Extend the existing `question_attempts` object and keep wrong and corrected attempts under one question. Add an evidence-aware correction API, mirror it in the static adapter, then replace the Practice page's direct correction button with a compact inline form.

**Tech Stack:** Go, SQLite migrations, React 19, TypeScript, Vitest/Testing Library, Playwright.

## Task 1: Persistence contract

- [ ] Add red model/store/migration tests for `answer`, `elapsed_ms`, `is_correct`, legacy conversion, and latest correction projection.
- [ ] Add schema v15 to fresh schema and migrations; verify schema head dependencies.
- [ ] Extend `QuestionAttempt`, `MistakeInput`, and `Mistake` models.
- [ ] Implement evidence-aware, idempotent correction storage and list/read projection.
- [ ] Run focused Go tests and commit `feat: persist mistake correction evidence`.

## Task 2: HTTP and static contract

- [ ] Add red HTTP tests for required trimmed answer, non-negative elapsed time, response evidence, and duplicate idempotency.
- [ ] Update `/mistakes/{attemptID}/correct` request decoding and error mapping.
- [ ] Add red static adapter tests and mirror the same evidence behavior.
- [ ] Update the frontend API types and helper payload with focused tests.
- [ ] Run focused Go/Vitest/lint/type checks and commit `feat: expose mistake correction evidence`.

## Task 3: Practice interaction

- [ ] Add red Practice tests for opening/cancelling the form, submitting answer + elapsed time, rendering saved evidence, and retaining input on failure.
- [ ] Implement one-row inline correction state and timer without changing quick capture.
- [ ] Update static Pages smoke to correct a fixture, revisit the route, and see the evidence without backend requests.
- [ ] Run focused tests and commit `feat: capture correction answers in practice`.

## Task 4: Documentation, full verification, and push

- [ ] Update `ROADMAP.md` to schema v15 and the real question-attempt evidence boundary.
- [ ] Update architecture consistency checks for the v15 columns/contract.
- [ ] Run `go test -p=1 ./...`, `go vet ./...`, full Vitest, lint, typecheck, static build, Pages contracts, architecture contracts, and Pages preview smoke.
- [ ] Push each green commit to `origin/main`, verify local/remote hashes, and leave `k.json` untouched.
