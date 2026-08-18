# Local Sidebar Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GitHub-backed sidebar avatar and username with a stable local Study OS brand block that still navigates home.

**Architecture:** Simplify `SidebarProfile` into a stateless local component using the existing lucide icon package and CSS. Remove the now-unused GitHub profile helper module, while preserving the `/` link, focus behavior, and mobile navigation callback.

**Tech Stack:** React 19, React Router, lucide-react, Tailwind CSS, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify `frontend/src/components/layout/SidebarProfile.test.tsx`: specify local branding, absence of remote image/profile content, and preserved navigation behavior.
- Modify `frontend/src/components/layout/AppShell.test.tsx`: update the two-rail header assertion to the local brand while preserving rail ordering.
- Modify `frontend/src/components/layout/SidebarProfile.tsx`: render the local brand mark and text.
- Delete `frontend/src/lib/profile.ts`: remove the GitHub username, avatar URL builder, size constant, and fallback initial helper once no callers remain.

### Task 1: Add failing local-brand regression coverage

**Files:**
- Test: `frontend/src/components/layout/SidebarProfile.test.tsx`

- [ ] **Step 1: Update the test helper so navigation callbacks can be verified**

Replace `renderProfile` with:

```tsx
function renderProfile(onNavigate?: () => void) {
  return render(
    <MemoryRouter>
      <SidebarProfile onNavigate={onNavigate} />
    </MemoryRouter>,
  )
}
```

- [ ] **Step 2: Replace the three GitHub-avatar tests with a local-brand test**

Remove the public endpoint, requested image size, and image-error fallback tests. Add:

```tsx
it("renders a local application brand instead of a remote profile image", () => {
  const { container } = renderProfile()

  expect(screen.getByText("学习系统")).toBeInTheDocument()
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  expect(screen.queryByText("dieWehmut")).not.toBeInTheDocument()
  expect(container.innerHTML).not.toMatch(/github/i)
})
```

- [ ] **Step 3: Extend the home-link test to preserve the mobile callback**

Replace `names the profile and links it home` with:

```tsx
it("links the local brand home and reports navigation", () => {
  const onNavigate = vi.fn()
  renderProfile(onNavigate)

  const homeLink = screen.getByRole("link", { name: /回到首页/ })
  expect(homeLink).toHaveAttribute("href", "/")
  fireEvent.click(homeLink)
  expect(onNavigate).toHaveBeenCalledOnce()
})
```

Update the Vitest import to include `vi`; keep `fireEvent` because the navigation test uses it.

- [ ] **Step 4: Run the focused test and verify RED**

Run from `frontend`:

```powershell
pnpm test --run src/components/layout/SidebarProfile.test.tsx
```

Expected: FAIL because the current component renders an `<img>`, `dieWehmut`, and GitHub-derived content instead of “学习系统”.

- [ ] **Step 5: Commit the red tests only**

```powershell
git add -- frontend/src/components/layout/SidebarProfile.test.tsx
git diff --cached --check
git commit -m "test: cover local sidebar branding"
```

### Task 2: Replace the remote avatar with a local brand mark

**Files:**
- Modify: `frontend/src/components/layout/SidebarProfile.tsx`
- Delete: `frontend/src/lib/profile.ts`
- Test: `frontend/src/components/layout/SidebarProfile.test.tsx`

- [ ] **Step 1: Replace SidebarProfile with the stateless local implementation**

Use:

```tsx
import { BookOpen } from "lucide-react"
import { Link } from "react-router-dom"

interface SidebarProfileProps {
  onNavigate?: () => void
}

const brandMarkSize = 152

export function SidebarProfile({ onNavigate }: SidebarProfileProps) {
  return (
    <div className="flex flex-col items-center px-4 pb-3 pt-5">
      <Link
        to="/"
        aria-label="回到首页"
        onClick={onNavigate}
        className="rounded-2xl transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span
          aria-hidden="true"
          style={{ width: brandMarkSize, height: brandMarkSize }}
          className="grid place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm"
        >
          <BookOpen className="size-16" strokeWidth={1.75} />
        </span>
      </Link>

      <p className="mt-3 text-center text-xl font-extrabold leading-tight tracking-normal">
        学习系统
      </p>
    </div>
  )
}
```

This uses a familiar lucide learning icon, keeps stable 152px dimensions, and introduces no external asset request.

- [ ] **Step 2: Delete the unused GitHub profile helper**

Delete `frontend/src/lib/profile.ts`, then verify no references remain:

```powershell
rg -n "githubUser|githubAvatarURL|avatarRenderSize|profileInitial|@/lib/profile" frontend/src
```

Expected: no matches and `rg` exits with code 1 because the symbols are gone.

- [ ] **Step 3: Run the focused test and verify GREEN**

Run from `frontend`:

```powershell
pnpm test --run src/components/layout/SidebarProfile.test.tsx
```

Expected: both local-brand/navigation tests pass with no React warnings.

- [ ] **Step 4: Run the surrounding layout tests**

```powershell
pnpm test --run src/components/layout/AppShell.test.tsx src/components/layout/SidebarProfile.test.tsx
```

Expected: all layout tests pass; sidebar desktop/mobile composition is unchanged apart from the brand content.

- [ ] **Step 5: Commit the implementation**

From repository root:

```powershell
git add -- frontend/src/components/layout/SidebarProfile.tsx frontend/src/lib/profile.ts
git diff --cached --check
git commit -m "feat: replace remote sidebar avatar with local brand"
```

### Task 3: Run final frontend verification

**Files:**
- Verify the completed AI settings and sidebar increments together.

- [ ] **Step 1: Run both focused suites together**

From `frontend`:

```powershell
pnpm test --run src/features/settings/SettingsPanel.test.tsx src/components/layout/SidebarProfile.test.tsx src/components/layout/AppShell.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 2: Run the complete frontend test suite**

```powershell
pnpm test --run
```

Expected: zero failed test files and zero failed tests.

- [ ] **Step 3: Run lint and production build**

```powershell
pnpm lint
pnpm build
```

Expected: both commands exit 0.

- [ ] **Step 4: Verify repository cleanliness without touching user files**

From repository root:

```powershell
Set-Location ..
git diff --check
git status --short
git log -7 --oneline
```

Expected: only `?? k.json` remains; history shows separate design, plan, red-test, and implementation commits.
