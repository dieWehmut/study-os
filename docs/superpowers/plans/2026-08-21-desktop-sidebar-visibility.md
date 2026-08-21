# Desktop Sidebar Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow desktop users to hide and restore the fixed sidebar while tightening the desktop content gutter without changing mobile navigation.

**Architecture:** `AppShell` owns a persisted boolean and derives the desktop content padding from it. `Header` exposes a compact icon control immediately before `ThemeToggle`; `Sidebar` is removed from the desktop layout when hidden. Existing mobile drawer state remains separate.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, Testing Library.

---

### Task 1: Record the UI contract

**Files:**
- Create: `docs/superpowers/specs/2026-08-21-desktop-sidebar-visibility-design.md`
- Create: `docs/superpowers/plans/2026-08-21-desktop-sidebar-visibility.md`

- [x] **Step 1: Document the behavior and component boundaries**

The design records complete desktop hiding, persisted preference, reduced `lg` gutter, and unchanged mobile drawer behavior. This plan records the test-first execution order and exact files.

- [ ] **Step 2: Commit the contract**

```bash
git add docs/superpowers/specs/2026-08-21-desktop-sidebar-visibility-design.md docs/superpowers/plans/2026-08-21-desktop-sidebar-visibility.md
git commit -m "docs: specify desktop sidebar visibility"
```

### Task 2: Add regression tests before implementation

**Files:**
- Modify: `frontend/src/components/layout/AppShell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Cover the header order and semantics, the `md:pl-64` to `md:pl-0` transition, `desktop-sidebar` `aria-hidden`, persistence, restoration on mount, and mobile drawer independence.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/layout/AppShell.test.tsx --pool=forks --maxWorkers=1
```

Expected: the new desktop sidebar button cannot be found because `Header` has no desktop control and `AppShell` has no desktop visibility state.

### Task 3: Implement the smallest passing layout change

**Files:**
- Modify: `frontend/src/components/layout/AppShell.tsx`
- Modify: `frontend/src/components/layout/Header.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add persisted state and controlled layout**

Read `study-os.desktop-sidebar-hidden` defensively, pass the state and callback to `Header`, set `md:pl-0` when hidden, and keep the mobile drawer state separate.

- [ ] **Step 2: Add the adjacent icon control**

Use `PanelLeftClose` while visible and `PanelLeftOpen` while hidden. Add the stable `aria-label`, `aria-expanded`, `aria-controls="desktop-sidebar"`, and `title` values. Keep the control desktop-only.

- [ ] **Step 3: Tighten the desktop gutter**

Change the shell's header, static banner, and main content large-screen padding from `lg:px-8` to `lg:px-5`.

- [ ] **Step 4: Run the focused test and refactor only after green**

```bash
pnpm --dir frontend exec vitest run src/components/layout/AppShell.test.tsx --pool=forks --maxWorkers=1
```

### Task 4: Verify, commit, and push the UI slice

**Files:**
- No additional files.

- [ ] **Step 1: Run frontend checks**

```bash
pnpm --dir frontend lint
pnpm --dir frontend exec tsc -b --pretty false
pnpm --dir frontend exec vitest run --pool=forks --maxWorkers=2 --reporter=dot
```

- [ ] **Step 2: Commit and push**

```bash
git add frontend/src/components/layout/AppShell.tsx frontend/src/components/layout/Header.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/AppShell.test.tsx
git commit -m "feat: allow hiding desktop sidebar"
git push origin main
```

- [ ] **Step 3: Confirm the remote commit**

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

The two hashes must match before reporting the slice as pushed.
