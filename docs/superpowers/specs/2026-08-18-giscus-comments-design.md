# Giscus Comments Design

## Status

Approved design for implementation on the GitHub Pages static build.

## Goal

Add an embedded Giscus discussion block to the bottom of every application
route on GitHub Pages. Each route must resolve to its own GitHub Discussion,
while the desktop/backend build remains unchanged.

## Constraints

- GitHub Pages uses `HashRouter`; browser `pathname` does not contain the
  application route.
- Giscus configuration values are public build-time identifiers, not secrets.
- The repository must have GitHub Discussions enabled, the Giscus App
  installed, and a usable discussion category before comments can load.
- No backend endpoint is available on Pages.
- Existing route content and the static-demo API behavior must remain intact.

## Architecture

Create a focused comments feature:

- `frontend/src/features/comments/giscus-config.ts` validates the four
  required `VITE_GISCUS_*` values and creates a stable discussion term from
  the current React Router pathname.
- `frontend/src/features/comments/GiscusComments.tsx` renders the official
  `@giscus/react` component. It returns nothing outside static-demo mode or
  when configuration is incomplete.
- `frontend/src/features/comments/GiscusComments.test.tsx` covers the
  configuration guard, route-specific terms, and theme/config props.

Mount `GiscusComments` as the final sibling inside `AppShell`'s `<main>`,
after route children. This gives every route a consistent bottom section
without adding navigation or duplicating page markup.

Use the official React wrapper rather than manual script injection. Its props
map directly to Giscus attributes and it updates the embedded iframe when the
route term or theme changes.

## Giscus Mapping

Use `mapping="specific"` and a term such as
`study-os:/knowledge` or `study-os:/reading/articles/article-1`.

Do not use `pathname` or `url` mapping: on a Pages project site those values
remain `/study-os/` after the hash is stripped, which would merge every route
into one discussion.

Use these fixed options:

- `reactionsEnabled`: enabled
- `emitMetadata`: disabled
- `inputPosition`: bottom
- `lang`: `zh-CN`
- `loading`: lazy
- `strict`: enabled to avoid fuzzy route matches

The Giscus theme follows the application's current light/dark state. The
component observes the `dark` class on `document.documentElement` with a
`MutationObserver` and passes `light` or `dark` to the wrapper; no new theme
store is introduced.

## Configuration

The Pages workflow passes these repository variables into both the build and
the Pages smoke-test environment:

- `VITE_GISCUS_REPO`
- `VITE_GISCUS_REPO_ID`
- `VITE_GISCUS_CATEGORY`
- `VITE_GISCUS_CATEGORY_ID`

The values are embedded at build time and must never contain OAuth tokens or
API keys. If any value is absent, the component stays hidden and the build
continues; this prevents a malformed iframe from breaking the static site.

The current repository ID is `R_kgDOTp_mMw`. The category ID must be obtained
from the Giscus generator after Discussions and a category are enabled; it
must not be guessed or committed until verified.

Document the one-time repository setup in `frontend/README.md`: enable
Discussions, install the Giscus App for the repository, create/select a
category (prefer `Announcements`), add the four repository variables, and
push a new Pages build.

## Testing and Acceptance

- Unit tests prove missing configuration renders no widget.
- Unit tests prove static mode renders the widget with `mapping="specific"`
  and distinct terms for distinct routes.
- Unit tests prove the current light/dark theme is passed through.
- Pages contract tests prove all four workflow variables are forwarded to
  the build and smoke-test steps.
- The existing static smoke test continues to assert that no `/api` request
  is made; Giscus network requests are external and do not become backend
  dependencies.
- A configured Pages build must show a Giscus iframe below each route and
  route changes must switch the associated discussion.

## Non-goals

- No server-side comments API or local comment storage.
- No OAuth token handling in the application.
- No changes to the non-static desktop/backend experience.
- No custom Giscus theme CSS or moderation automation.
