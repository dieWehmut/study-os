# GitHub Pages Static Frontend Demo Implementation Plan

> **For agentic workers:** execute each task in order, keep commits focused,
> and run the listed verification before moving on. Work directly on `main`.

**Goal:** Publish a repository-subpath-safe React frontend that works as a
purely static GitHub Pages showcase.

**Architecture:** A build-time `VITE_STATIC_DEMO` flag selects a HashRouter and
an in-memory API fixture adapter. Vite's `VITE_BASE_PATH` handles repository
assets. Local/desktop builds retain BrowserRouter and the real API. Pages is
deployed by a dedicated GitHub Actions workflow.

## Task 1: Red tests for the static contract

Files:

- Create `frontend/src/lib/runtime.test.ts`
- Create `frontend/src/lib/routing.test.ts`
- Create `frontend/src/api/static-demo.test.ts`
- Extend `frontend/src/lib/pwa.test.ts`
- Create `scripts/tests/github-pages-build.test.mjs` if a build-manifest test
  is needed

Tests must initially fail for the missing runtime helper, router mode, static
adapter, and Pages-safe service-worker behavior. Commit only the tests.

## Task 2: Runtime, router, and asset base

Files:

- Create `frontend/src/lib/runtime.ts`
- Modify `frontend/src/main.tsx`
- Modify `frontend/src/lib/pwa.ts`
- Modify `frontend/vite.config.ts`
- Modify `frontend/index.html`
- Modify `frontend/public/manifest.webmanifest`

Implement the static-mode branch, HashRouter selection, configurable Vite
base, and disabled static service worker. Keep local behavior unchanged.

## Task 3: In-memory API fixtures

Files:

- Create `frontend/src/api/static-demo.ts`
- Modify `frontend/src/api/client.ts`
- Modify direct backend calls in `App.tsx`, `UpdateDialog.tsx`,
  `SettingsPanel.tsx`, and audio helpers as required

Cover deterministic dashboard, knowledge, review, chat, integrate, settings,
practice, and English article reads plus representative local mutations. Return
typed payloads matching the existing API modules. Unknown server-only actions
must fail with an explicit static-demo error rather than issuing a network
request.

## Task 4: Pages deployment and documentation

Files:

- Create `.github/workflows/deploy-pages.yml`
- Update `frontend/README.md` or the root README with local Pages build and
  preview commands

The workflow must grant only Pages deployment permissions, use the lockfile,
derive the base path from `github.event.repository.name`, and never build or
start Go.

## Task 5: Verification

Run:

- focused Vitest tests for runtime, routing, static adapter, and PWA;
- `pnpm lint`;
- normal `pnpm build`;
- `VITE_STATIC_DEMO=true VITE_BASE_PATH=/study-os/ pnpm build`;
- a static-server/Playwright smoke check for `/#/` and `/#/knowledge` with no
  `/api` requests;
- `git diff --check` and a final status check preserving `k.json`.

Commit each task separately and report the commit ids with verification output.
