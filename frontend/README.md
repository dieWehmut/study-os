# Study OS Frontend

React 19 + TypeScript + Vite 8 + Tailwind 4 + Base UI (shadcn-compatible) + Zustand.

## Commands

```powershell
pnpm install
pnpm dev                    # dev server, /api proxied to http://127.0.0.1:8080
pnpm test -- --run          # Vitest unit/component tests
pnpm lint                   # ESLint
pnpm build                  # tsc -b && vite build
pnpm run e2e                # Playwright (desktop + mobile viewports)
```

The e2e suite (`e2e/study-loop.spec.ts`) starts its own backend (`go build ./backend`) on port 8080 and a Vite server on port 5174 with an isolated data directory (`frontend/.e2e-data/run-*`). Keep ports 8080 and 5174 free when running it.

## GitHub Pages

The Pages deployment is a frontend-only showcase. It does not build or start
the Go service. The workflow sets `VITE_STATIC_DEMO=true` and takes
`VITE_BASE_PATH` from `actions/configure-pages`, so project sites, user sites,
and custom domains all receive the correct asset base before `frontend/dist`
is uploaded.

To build the same artifact locally for this repository:

```powershell
$env:VITE_STATIC_DEMO = "true"
$env:VITE_BASE_PATH = "/study-os/"
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/study-os/#/`. Static mode uses hash routes so a
refresh does not need a server-side SPA rewrite. API responses come from a
deterministic in-memory fixture and mutations last only for the current tab;
the site never sends requests to `/api` and does not persist backend data.

The backend-free browser smoke test uses its own Vite server and config:

```powershell
pnpm exec playwright test --config=playwright.pages.config.ts
```

### Giscus comments

The Pages build renders one Giscus discussion at the bottom of every hash
route. Complete this one-time repository setup before deploying the widget:

1. Enable Discussions in repository **Settings > General > Features**.
2. Install the [Giscus GitHub App](https://github.com/apps/giscus) for
   `dieWehmut/study-os`.
3. Create or select an `Announcements` discussion category.
4. Open [giscus.app](https://giscus.app/zh-CN), select the repository and
   category, then copy the generated repository and category IDs.
5. Add repository variables named `GISCUS_REPO`, `GISCUS_REPO_ID`,
   `GISCUS_CATEGORY`, and `GISCUS_CATEGORY_ID`.
6. Push `main` or dispatch the `Deploy GitHub Pages` workflow again.

These values are public identifiers embedded in the frontend bundle. Never
put an OAuth token, personal access token, GitHub secret, or API key in a
`VITE_*` variable. Until all four variables are configured, the comments
component stays hidden and the rest of the static site continues to work.

## Structure

- `src/api` — typed REST clients and the runtime API resolver (browser-relative vs. Wails bridge).
- `src/features` — feature components (import wizard, knowledge Wiki, review session, settings panel).
- `src/components/layout` — app shell, responsive navigation, theme toggle.
- `src/store` — UI-only Zustand stores; learning state stays server-authoritative.
- `src/lib` — theme, settings persistence, PWA registration, utilities.
- `public` — PWA icons, manifest, service worker.

## PWA

`src/lib/pwa.ts` registers the service worker in production builds of the
backend-backed app; Pages static mode intentionally skips it because the
worker's root scope cannot provide useful backend or repository-subpath
offline behavior. The manifest and icons live in `public/`. v0.1 intentionally
does not advertise LAN/mobile sync.
