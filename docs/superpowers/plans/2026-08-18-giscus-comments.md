# Giscus Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed an independent Giscus discussion at the bottom of every GitHub Pages route without changing the backend build.

**Architecture:** Add a small `features/comments` module backed by the official `@giscus/react` wrapper. The module reads four public Vite variables, derives a stable `specific` discussion term from React Router's pathname, observes the existing root `dark` class for theme changes, and renders only in static-demo mode with complete configuration. AppShell mounts it after route content; the Pages workflow forwards repository variables to both build and smoke-test steps.

**Tech Stack:** React 19, React Router 7, Vite, Vitest/Testing Library, pnpm, GitHub Actions, `@giscus/react`.

---

### Task 1: Add Giscus Configuration Helper

**Files:**
- Modify: `frontend/package.json` and `frontend/pnpm-lock.yaml` via `pnpm add @giscus/react`
- Create: `frontend/src/features/comments/giscus-config.ts`
- Create: `frontend/src/features/comments/giscus-config.test.ts`

- [ ] **Step 1: Add the official React wrapper dependency**

Run from the repository root:

```powershell
pnpm --dir frontend add @giscus/react
```

Expected: `frontend/package.json` and `frontend/pnpm-lock.yaml` gain the dependency, with no backend package changes.

- [ ] **Step 2: Write the failing configuration tests**

Add tests that define the required behavior:

```ts
import { describe, expect, it } from "vitest"
import { giscusConfig, giscusTerm, type GiscusEnv } from "./giscus-config"

const configured: GiscusEnv = {
  VITE_GISCUS_REPO: "dieWehmut/study-os",
  VITE_GISCUS_REPO_ID: "R_kgDOTp_mMw",
  VITE_GISCUS_CATEGORY: "Announcements",
  VITE_GISCUS_CATEGORY_ID: "DIC_kwDOexample",
}

describe("giscus configuration", () => {
  it("returns null until all public identifiers are configured", () => {
    expect(giscusConfig({ ...configured, VITE_GISCUS_CATEGORY_ID: "" })).toBeNull()
  })

  it("normalizes route terms without a trailing slash", () => {
    expect(giscusTerm("/")).toBe("study-os:/")
    expect(giscusTerm("/knowledge/")).toBe("study-os:/knowledge")
    expect(giscusTerm("/reading/articles/article-1")).toBe("study-os:/reading/articles/article-1")
  })

  it("returns the exact public Giscus configuration", () => {
    expect(giscusConfig(configured)).toEqual({
      repo: configured.VITE_GISCUS_REPO,
      repoId: configured.VITE_GISCUS_REPO_ID,
      category: configured.VITE_GISCUS_CATEGORY,
      categoryId: configured.VITE_GISCUS_CATEGORY_ID,
    })
  })
})
```

- [ ] **Step 3: Run the focused tests and verify the expected red result**

Run:

```powershell
pnpm --dir frontend exec vitest run src/features/comments/giscus-config.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because `giscus-config.ts` does not exist yet.

- [ ] **Step 4: Implement the minimal helper**

Create the exported types and functions:

```ts
export interface GiscusEnv {
  VITE_GISCUS_REPO?: string
  VITE_GISCUS_REPO_ID?: string
  VITE_GISCUS_CATEGORY?: string
  VITE_GISCUS_CATEGORY_ID?: string
}

export interface GiscusConfig {
  repo: string
  repoId: string
  category: string
  categoryId: string
}

const clean = (value: string | undefined) => value?.trim() ?? ""

export function giscusConfig(env: GiscusEnv): GiscusConfig | null {
  const repo = clean(env.VITE_GISCUS_REPO)
  const repoId = clean(env.VITE_GISCUS_REPO_ID)
  const category = clean(env.VITE_GISCUS_CATEGORY)
  const categoryId = clean(env.VITE_GISCUS_CATEGORY_ID)
  if (!repo || !repoId || !category || !categoryId) return null
  return { repo, repoId, category, categoryId }
}

export function giscusTerm(pathname: string): string {
  const normalized = `/${pathname.replace(/^\/+|\/+$/g, "")}`
  return `study-os:${normalized === "/" ? "/" : normalized}`
}
```

- [ ] **Step 5: Run focused tests and commit**

Run the same Vitest command; expected: 3 tests pass. Then commit only the
dependency and helper files:

```powershell
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/features/comments
git commit -m "feat: add Giscus configuration helper"
```

### Task 2: Implement the Giscus Component

**Files:**
- Create: `frontend/src/features/comments/GiscusComments.tsx`
- Create: `frontend/src/features/comments/GiscusComments.test.tsx`

- [ ] **Step 1: Write component tests with a mocked wrapper**

Mock `@giscus/react` to render its received props as a test element. Cover:

```tsx
vi.mock("@giscus/react", () => ({
  default: (props: Record<string, unknown>) => <div data-testid="giscus" {...props} />,
}))
```

The tests must prove that an incomplete config renders nothing, static mode
passes `mapping="specific"`, `/knowledge` becomes
`study-os:/knowledge`, and the current root theme is passed as `light` or
`dark`. Stub `VITE_STATIC_DEMO` with `vi.stubEnv` and restore it after each
test.

- [ ] **Step 2: Run the component tests and verify they fail for the missing component**

```powershell
pnpm --dir frontend exec vitest run src/features/comments/GiscusComments.test.tsx --pool=threads --maxWorkers=1
```

Expected: FAIL because the component has not been created.

- [ ] **Step 3: Implement the component**

The component must:

1. Read `useLocation()` and pass `giscusTerm(location.pathname)`.
2. Return `null` if `isStaticDemo()` is false or `giscusConfig(import.meta.env)` is null.
3. Track `document.documentElement.classList.contains("dark")` in state.
4. Use a `MutationObserver` on the root element's `class` attribute, guarded
   for environments without `MutationObserver`.
5. Render a single `section` with a stable `aria-label="页面评论"`, a small
   heading, and the official component configured with:

```tsx
<Giscus
  repo={config.repo}
  repoId={config.repoId}
  category={config.category}
  categoryId={config.categoryId}
  mapping="specific"
  term={term}
  strict="1"
  reactionsEnabled="1"
  emitMetadata="0"
  inputPosition="bottom"
  theme={dark ? "dark" : "light"}
  lang="zh-CN"
  loading="lazy"
/>
```

Use `key={term}` on the wrapper so changing routes cannot retain the previous
route's discussion while the iframe updates.

- [ ] **Step 4: Run component and helper tests, then commit**

```powershell
pnpm --dir frontend exec vitest run src/features/comments/giscus-config.test.ts src/features/comments/GiscusComments.test.tsx --pool=threads --maxWorkers=1
```

Expected: all focused tests pass. Commit:

```powershell
git add frontend/src/features/comments
git commit -m "feat: render route-scoped Giscus comments"
```

### Task 3: Mount Comments in AppShell

**Files:**
- Modify: `frontend/src/components/layout/AppShell.tsx`
- Modify: `frontend/src/components/layout/AppShell.test.tsx`

- [ ] **Step 1: Add the AppShell regression test**

Mock `GiscusComments` and add a static-demo test that renders AppShell around
`MemoryRouter` content, then asserts the comments marker is below the route
content. Add a non-static test asserting the marker is absent.

- [ ] **Step 2: Run the AppShell test before integration**

```powershell
pnpm --dir frontend exec vitest run src/components/layout/AppShell.test.tsx --pool=threads --maxWorkers=1
```

Expected: the new static test fails because AppShell has no comments mount.

- [ ] **Step 3: Mount the component after route children**

Import `GiscusComments` and place `<GiscusComments />` immediately after
`{children}` inside the existing `<main>`. Do not add it to the Sidebar,
Header, or navigation.

- [ ] **Step 4: Run and commit the AppShell integration**

Run the focused AppShell tests; expected: all pass. Commit:

```powershell
git add frontend/src/components/layout/AppShell.tsx frontend/src/components/layout/AppShell.test.tsx
git commit -m "feat: mount comments below every page"
```

### Task 4: Wire Pages Variables and Setup Documentation

**Files:**
- Modify: `.github/workflows/deploy-pages.yml`
- Modify: `scripts/tests/github-pages.test.mjs`
- Modify: `frontend/README.md`

- [ ] **Step 1: Extend the Pages contract test first**

Assert that both the build and smoke-test environments contain these
expressions:

```text
VITE_GISCUS_REPO: ${{ vars.GISCUS_REPO }}
VITE_GISCUS_REPO_ID: ${{ vars.GISCUS_REPO_ID }}
VITE_GISCUS_CATEGORY: ${{ vars.GISCUS_CATEGORY }}
VITE_GISCUS_CATEGORY_ID: ${{ vars.GISCUS_CATEGORY_ID }}
```

The test must require each variable in both `Build frontend showcase` and
`Smoke test built Pages artifact` blocks.

- [ ] **Step 2: Run the contract test and verify the expected red result**

```powershell
node --test scripts/tests/github-pages.test.mjs
```

Expected: FAIL because the workflow has no Giscus environment variables.

- [ ] **Step 3: Add the variables to both workflow environments**

Add the four `VITE_GISCUS_*` entries to the build and smoke `env` blocks. Use
GitHub Repository Variables, not Secrets; these IDs are public. Do not add a
category ID fallback. A missing variable must keep the component hidden until
the repository owner configures a real category.

- [ ] **Step 4: Document the external one-time setup**

Add a `Giscus comments` section to `frontend/README.md` with these exact
steps:

1. Enable Discussions in repository Settings > General > Features.
2. Install the Giscus GitHub App for `dieWehmut/study-os`.
3. Create/select an `Announcements` discussion category.
4. Open `https://giscus.app/zh-CN`, select the repository/category, and copy
   the generated repository and category IDs.
5. Add repository variables `GISCUS_REPO`, `GISCUS_REPO_ID`,
   `GISCUS_CATEGORY`, and `GISCUS_CATEGORY_ID`.
6. Push `main` or dispatch `Deploy GitHub Pages` again.

State explicitly that values are public identifiers and OAuth/PAT values must
never be put in Vite variables.

- [ ] **Step 5: Run the contract test and commit**

Expected: 2 Pages contract tests pass. Commit:

```powershell
git add .github/workflows/deploy-pages.yml scripts/tests/github-pages.test.mjs frontend/README.md
git commit -m "ci: configure Giscus Pages variables"
```

### Task 5: Full Verification and Pages Deployment

**Files:**
- No new files; verify the commits above.

- [ ] **Step 1: Run all affected unit tests**

```powershell
pnpm --dir frontend exec vitest run src/features/comments/giscus-config.test.ts src/features/comments/GiscusComments.test.tsx src/components/layout/AppShell.test.tsx src/lib/runtime.test.ts --pool=threads --maxWorkers=1
```

Expected: all tests pass.

- [ ] **Step 2: Run lint, typecheck, and the Pages contract**

```powershell
pnpm --dir frontend lint
pnpm --dir frontend exec tsc -b --pretty false
node --test scripts/tests/github-pages.test.mjs
```

Expected: exit code 0 for all commands.

- [ ] **Step 3: Build the static artifact with an empty category ID**

```powershell
$env:VITE_STATIC_DEMO = "true"
$env:VITE_BASE_PATH = "/study-os/"
$env:VITE_GISCUS_REPO = "dieWehmut/study-os"
$env:VITE_GISCUS_REPO_ID = "R_kgDOTp_mMw"
$env:VITE_GISCUS_CATEGORY = "Announcements"
$env:VITE_GISCUS_CATEGORY_ID = ""
pnpm --dir frontend build
```

Expected: build succeeds and the static app contains no malformed Giscus
iframe when the category ID is absent.

- [ ] **Step 4: Push the committed changes to `main`**

```powershell
git push origin main
```

- [ ] **Step 5: Monitor the `Deploy GitHub Pages` run**

Confirm Configure Pages, build, artifact smoke, and deploy jobs are all
successful. With repository variables configured, verify the live URL
`https://diewehmut.github.io/study-os/` returns `200` and each hash route
contains a Giscus widget request.

- [ ] **Step 6: Preserve unrelated worktree state**

Confirm `k.json` remains untracked and no unrelated files are staged.
