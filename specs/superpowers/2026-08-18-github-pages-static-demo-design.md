# GitHub Pages Static Frontend Demo

## Status

Approved implementation direction for the `main` branch.

## Goal

Publish the React frontend as a GitHub Pages site that renders under the
repository subpath and remains useful without the Go service. The Pages build
is a read-only, deterministic showcase: navigation and representative workflows
work in the browser, while changes live only in memory and local browser
storage where the existing frontend already uses it.

## Constraints

- GitHub Pages serves static files only; the published site must never require
  `/api` or a backend process to render a route.
- The repository name is not hard-coded into the application. The workflow
  supplies the Vite base path, so forks and renamed repositories can publish
  correctly.
- Normal development, desktop packaging, and the existing backend-backed app
  keep their current API and router behavior.
- `k.json`, ignored prompt sources, and unrelated user changes remain
  untouched.

## Runtime Modes

`VITE_STATIC_DEMO=true` selects the Pages runtime. The mode is exposed through a
small runtime helper rather than scattered environment checks.

In static mode:

- Vite uses the configured repository base path.
- `HashRouter` keeps deep links and refreshes valid on Pages without rewrite
  support.
- API modules call an in-memory fixture adapter. It covers the initial GETs and
  common demo actions used by Home, Knowledge, Memory, Integrate, Chat,
  Settings, Practice, and English Articles. Mutations update the adapter's
  in-memory state for the current tab only.
- Backend-only lifecycle calls, update polling, and server audio generation are
  skipped; browser speech remains available as a local fallback.
- The service worker is disabled. A broken root-scoped worker is worse than no
  offline cache under a repository subpath, and Pages itself already provides
  immutable static assets.

In non-static mode the existing `BrowserRouter`, `/api` client, service worker,
and backend workflows remain unchanged.

## Assets and Deployment

`vite.config.ts` reads `VITE_BASE_PATH` and passes it to Vite's `base`. Public
HTML and manifest references use Vite's base placeholder. The Pages workflow:

1. checks out `main`;
2. installs the locked frontend dependencies;
3. builds with `VITE_STATIC_DEMO=true` and a base derived from the repository
   name;
4. uploads `frontend/dist` as a Pages artifact;
5. deploys it with the official Pages action.

## Verification

- Unit tests prove runtime mode detection, router selection, fixture reads and
  mutations, and that static mode does not register a service worker.
- A Pages build is run with `/study-os/` (the current repository name), then
  checks confirm all generated asset URLs stay under that prefix and no backend
  process is started by the workflow.
- Playwright serves the built artifact and checks the root hash route plus a
  representative deep route without any `/api` requests.
