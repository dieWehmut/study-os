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

## Structure

- `src/api` — typed REST clients and the runtime API resolver (browser-relative vs. Wails bridge).
- `src/features` — feature components (import wizard, knowledge Wiki, review session, settings panel).
- `src/components/layout` — app shell, responsive navigation, theme toggle.
- `src/store` — UI-only Zustand stores; learning state stays server-authoritative.
- `src/lib` — theme, settings persistence, PWA registration, utilities.
- `public` — PWA icons, manifest, service worker.

## PWA

`src/lib/pwa.ts` registers the service worker in production builds; the manifest and icons live in `public/`. v0.1 intentionally does not advertise LAN/mobile sync.
