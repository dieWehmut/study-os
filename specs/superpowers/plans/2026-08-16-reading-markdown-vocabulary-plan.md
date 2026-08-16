# Reading Markdown Vocabulary Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a responsive Markdown editor/preview workspace on `阅读` that highlights the approved English lexicon and resolves missing meanings through an idempotent AI-backed knowledge lookup.

**Architecture:** Generate a compact tracked lexicon from the ignored MOC sources, then run a pure longest-match tokenizer over safe React Markdown text nodes. A dedicated backend service performs exact local lookup before contextual `word_wiki` generation and persistence; the Reading page owns only selection/UI state and preserves its current lower reader.

**Tech Stack:** Go 1.25, Chi, SQLite, React 19, TypeScript 6, React Markdown, remark-gfm, remark-math, rehype-katex, Base UI Dialog, Vitest/Testing Library, Playwright.

---

## File Map

- `scripts/vocabulary-lexicon.mjs`: parse Obsidian wiki-link indexes into normalized entries.
- `scripts/build-vocabulary-lexicon.mjs`: CLI that reads ignored MOCs and writes deterministic TypeScript.
- `scripts/tests/vocabulary-lexicon.test.mjs`: parser/serializer contract using Node's test runner.
- `frontend/src/generated/vocabulary-lexicon.ts`: checked-in compact build artifact used at runtime.
- `frontend/src/lib/vocabulary-matcher.ts`: trie/token matching with longest expression priority.
- `backend/agent/{provider.go,prompts.go,mock.go}`: contextual lookup-capable word-wiki contract.
- `backend/db/store.go`: exact normalized English-term query.
- `backend/knowledge/vocabulary.go`: validation, local-first lookup, generation, deterministic identity, persistence.
- `backend/httpapi/vocabulary.go`: `POST /api/knowledge/lookup` transport.
- `frontend/src/features/reading/markdown-source.ts`: safe Obsidian-to-renderable Markdown normalization.
- `frontend/src/features/reading/MarkdownPreview.tsx`: React Markdown rendering and vocabulary buttons.
- `frontend/src/features/reading/VocabularyPopover.tsx`: anchored desktop panel/mobile dialog and request state.
- `frontend/src/features/reading/MarkdownWorkspace.tsx`: split-pane composition.
- `frontend/src/pages/{Reading.tsx,Knowledge.tsx}`: page integration and knowledge deep-link handling.
- `frontend/e2e/reading-markdown-vocabulary.spec.ts`: desktop/mobile workflow proof.

## Preflight

- [ ] **Step 1: Confirm the branch and protected paths**

Run:

```powershell
git status --short
git branch --show-current
git check-ignore -v docs prompt k.json
```

Expected: branch `main`; `k.json` may be untracked; `docs` and `prompt` are ignored. Never use `git add .` in this plan.

- [ ] **Step 2: Confirm the design commit is on the remote**

Run:

```powershell
git fetch origin
git merge-base --is-ancestor c9291d4 origin/main
```

Expected: exit code `0`.

### Task 1: Deterministic Lexicon and Longest-Match Tokenizer

**Files:**
- Create: `scripts/vocabulary-lexicon.mjs`
- Create: `scripts/build-vocabulary-lexicon.mjs`
- Create: `scripts/tests/vocabulary-lexicon.test.mjs`
- Create: `frontend/src/generated/vocabulary-lexicon.ts`
- Create: `frontend/src/lib/vocabulary-matcher.ts`
- Create: `frontend/src/lib/vocabulary-matcher.test.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write the failing MOC parser test**

Create a Node test that fixes alias, kind, deduplication, and deterministic ordering:

```js
import test from "node:test"
import assert from "node:assert/strict"
import { extractEntries, serializeLexicon } from "../vocabulary-lexicon.mjs"

test("extracts aliases and keeps expressions ahead of contained words", () => {
  const words = "## A\n[[word-wiki/last|last]] · [[word-wiki/at|at]]"
  const expressions = "## A–Z\n### A\n- [[at last]] `fixed-expression`\n- [[A as well as B|as well as]] `fixed-expression`"
  const entries = [
    ...extractEntries(words, "word"),
    ...extractEntries(expressions, "expression"),
  ]

  assert.deepEqual(entries.find((entry) => entry.display === "as well as"), {
    normalized: "as well as",
    display: "as well as",
    kind: "expression",
  })
  assert.ok(serializeLexicon(entries).indexOf('"at last"') < serializeLexicon(entries).indexOf('"at"'))
})
```

- [ ] **Step 2: Verify the parser test is RED**

Run:

```powershell
node --test scripts/tests/vocabulary-lexicon.test.mjs
```

Expected: FAIL because `scripts/vocabulary-lexicon.mjs` does not exist.

- [ ] **Step 3: Implement normalization, extraction, and deterministic serialization**

Implement these public boundaries in `scripts/vocabulary-lexicon.mjs`:

```js
export function normalizeTerm(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
}

export function extractEntries(markdown, kind) {
  // Scan [[target|label]]/[[target]], accept word-wiki links for `word`, and
  // bullet links below the A–Z heading for `expression`. Return normalized,
  // display, kind objects; discard navigation and empty labels.
}

export function serializeLexicon(entries) {
  // Dedupe by normalized+kind, prefer expression on a cross-kind collision,
  // sort by normalized length descending then locale order, and emit a TS const.
}
```

The emitted file must have this stable shape so the matcher and generated data
share one type:

```ts
export interface VocabularyLexiconEntry {
  normalized: string
  display: string
  kind: "word" | "expression"
}
```

The serializer then emits `export const vocabularyLexicon: readonly VocabularyLexiconEntry[] = [...]` with one literal object for every extracted entry.

Implement `scripts/build-vocabulary-lexicon.mjs` with exact defaults and explicit overrides:

```js
const defaults = {
  single: "prompt/00-MOC.md",
  expressions: "prompt/00-MOC (1).md",
  out: "frontend/src/generated/vocabulary-lexicon.ts",
}
```

Add to `frontend/package.json`:

```json
"vocabulary:build": "node ../scripts/build-vocabulary-lexicon.mjs"
```

- [ ] **Step 4: Run parser tests and generate the tracked lexicon**

Run:

```powershell
node --test scripts/tests/vocabulary-lexicon.test.mjs
node scripts/build-vocabulary-lexicon.mjs
```

Expected: Node test PASS; generated file exports `VocabularyLexiconEntry` and `vocabularyLexicon` with both `word` and `expression` entries.

- [ ] **Step 5: Write the failing matcher tests**

Create `frontend/src/lib/vocabulary-matcher.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createVocabularyMatcher } from "./vocabulary-matcher"

const match = createVocabularyMatcher([
  { normalized: "at", display: "at", kind: "word" },
  { normalized: "last", display: "last", kind: "word" },
  { normalized: "at last", display: "at last", kind: "expression" },
  { normalized: "he", display: "he", kind: "word" },
])

it("uses the longest expression and preserves unmatched text", () => {
  expect(match("At last, he left.")).toEqual([
    { text: "At last", term: "at last", kind: "expression" },
    { text: ", ", term: null },
    { text: "he", term: "he", kind: "word" },
    { text: " left.", term: null },
  ])
})

it("does not match inside an English word", () => {
  expect(match("theatre")).toEqual([{ text: "theatre", term: null }])
})
```

- [ ] **Step 6: Verify matcher tests are RED**

Run:

```powershell
pnpm --dir frontend exec vitest run src/lib/vocabulary-matcher.test.ts
```

Expected: FAIL because `createVocabularyMatcher` is missing.

- [ ] **Step 7: Implement the trie matcher and verify GREEN**

Expose the exact runtime types:

```ts
import type { VocabularyLexiconEntry } from "@/generated/vocabulary-lexicon"

export type VocabularyToken =
  | { text: string; term: null }
  | { text: string; term: string; kind: VocabularyLexiconEntry["kind"] }

export function createVocabularyMatcher(entries: readonly VocabularyLexiconEntry[]) {
  return (text: string): VocabularyToken[] => {
    // Walk a case-folded trie from each English boundary, retain the longest
    // terminal match, and merge adjacent unmatched slices.
  }
}
```

Run:

```powershell
pnpm --dir frontend exec vitest run src/lib/vocabulary-matcher.test.ts
pnpm --dir frontend exec tsc -b --pretty false
```

Expected: matcher tests PASS and TypeScript exits `0`.

- [ ] **Step 8: Commit and push Task 1 by explicit path**

```powershell
git add -- scripts/vocabulary-lexicon.mjs scripts/build-vocabulary-lexicon.mjs scripts/tests/vocabulary-lexicon.test.mjs frontend/package.json frontend/src/generated/vocabulary-lexicon.ts frontend/src/lib/vocabulary-matcher.ts frontend/src/lib/vocabulary-matcher.test.ts
git diff --cached --check
git commit -m "feat: add reading vocabulary lexicon"
git push origin main
```

Expected: only the listed lexicon files are committed; `k.json` remains untracked.

### Task 2: Contextual Backend Lookup and Persistence

**Files:**
- Modify: `backend/agent/provider.go`
- Modify: `backend/agent/prompts.go`
- Modify: `backend/agent/mock.go`
- Modify: `backend/agent/mock_kinds_test.go`
- Modify: `backend/agent/provider_test.go`
- Modify: `backend/db/store.go`
- Modify: `backend/db/store_test.go`
- Create: `backend/knowledge/vocabulary.go`
- Create: `backend/knowledge/vocabulary_test.go`
- Create: `backend/httpapi/vocabulary.go`
- Create: `backend/httpapi/vocabulary_test.go`
- Modify: `backend/httpapi/router.go`

- [ ] **Step 1: Write RED Agent tests for context-only lookup**

Add assertions that the request is valid without a supplied definition only when context exists, and that Mock returns useful fields:

```go
request := agent.Request{Kind: agent.KindWordWiki, WordWiki: &agent.WordWikiInput{
    Term: "complicated", Context: "Tell me about a complicated man.",
}}
if err := request.Validate(); err != nil { t.Fatalf("validate: %v", err) }
response, err := agent.NewMockProvider().Generate(context.Background(), request)
if err != nil || response.WordWiki == nil { t.Fatalf("generate: %#v, %v", response, err) }
if response.WordWiki.ConciseDefinition == "" || response.WordWiki.PartOfSpeech == "" {
    t.Fatalf("word wiki = %#v", response.WordWiki)
}
```

- [ ] **Step 2: Verify Agent tests are RED**

Run:

```powershell
go test ./backend/agent -run 'WordWiki|Context' -count=1
```

Expected: FAIL because `Context` and output metadata do not exist and validation still requires `Definition`.

- [ ] **Step 3: Extend the Agent contract minimally**

Use these fields and validation rule in `backend/agent/provider.go`:

```go
type WordWikiInput struct {
    ID string `json:"id,omitempty"`
    Term string `json:"term"`
    Context string `json:"context,omitempty"`
    PartOfSpeech string `json:"part_of_speech,omitempty"`
    Definition string `json:"definition,omitempty"`
    Example string `json:"example,omitempty"`
    Level string `json:"level,omitempty"`
    Tags []string `json:"tags,omitempty"`
    SenseGroup string `json:"sense_group,omitempty"`
}

type WordWikiOutput struct {
    DetailedMarkdown string `json:"detailed_markdown"`
    ConciseDefinition string `json:"concise_definition"`
    PartOfSpeech string `json:"part_of_speech,omitempty"`
    Pronunciation string `json:"pronunciation,omitempty"`
    Example string `json:"example,omitempty"`
    MemoryTips stringList `json:"memory_tips,omitempty"`
    Collocations stringList `json:"collocations,omitempty"`
    WordFamily stringList `json:"word_family,omitempty"`
}
```

Validation: `Term` is required and at least one of `Definition` or `Context` is required. Update system/user prompts to request the new output fields and include context. Make Mock derive a deterministic non-empty contextual definition and example when definition is absent.

- [ ] **Step 4: Verify Agent tests are GREEN**

Run:

```powershell
go test ./backend/agent -count=1
```

Expected: PASS.

- [ ] **Step 5: Write RED Store exact-term tests**

Add a test that creates `abandon` and `abandoned`, then calls the wished-for API:

```go
item, err := store.FindKnowledgeItemByExactTerm(ctx, " ABANDON ", "english")
if err != nil { t.Fatalf("find exact: %v", err) }
if item.Term != "abandon" { t.Fatalf("term = %q", item.Term) }
if _, err := store.FindKnowledgeItemByExactTerm(ctx, "missing", "english"); !errors.Is(err, db.ErrNotFound) {
    t.Fatalf("missing error = %v", err)
}
```

- [ ] **Step 6: Verify Store test is RED, then implement exact lookup**

Run first:

```powershell
go test ./backend/db -run ExactTerm -count=1
```

Expected: FAIL because the method is missing.

Implement:

```go
func (s *Store) FindKnowledgeItemByExactTerm(ctx context.Context, term, subject string) (models.KnowledgeItem, error) {
    row := s.db.QueryRowContext(ctx, knowledgeSelect+`
        WHERE lower(trim(term)) = lower(trim(?)) AND lower(trim(subject)) = lower(trim(?))
        ORDER BY updated_at DESC, id ASC LIMIT 1`, term, subject)
    item, err := scanKnowledgeItem(row)
    if err != nil { return models.KnowledgeItem{}, mapNotFound(err, "knowledge item") }
    return item, nil
}
```

Run again; expected PASS.

- [ ] **Step 7: Write RED service tests for local-first and generated lookup**

The tests use a fake store and counting provider to assert:

```go
result, err := knowledge.LookupVocabulary(ctx, storeWith("abandon"), countingProvider, knowledge.LookupInput{
    Term: "Abandon", Context: "They had to abandon the car.", Kind: knowledge.KindWord,
})
if err != nil || result.Source != knowledge.SourceExisting { t.Fatalf("result = %#v, %v", result, err) }
if countingProvider.Calls != 0 { t.Fatalf("provider calls = %d", countingProvider.Calls) }
```

and, for a missing term, that one generated item has deterministic ID, English subject, `reading-vocabulary`/`ai-generated` tags, and no review prompts.

- [ ] **Step 8: Verify service tests are RED, then implement the service**

Run first:

```powershell
go test ./backend/knowledge -count=1
```

Expected: FAIL because the package is missing.

Define the public service contract before the implementation:

```go
type Kind string
const (
    KindWord Kind = "word"
    KindExpression Kind = "expression"
)
type Source string
const (
    SourceExisting Source = "existing"
    SourceGenerated Source = "generated"
)

type Store interface {
    FindKnowledgeItemByExactTerm(context.Context, string, string) (models.KnowledgeItem, error)
    CreateKnowledgeItem(context.Context, models.KnowledgeItem) error
    GetKnowledgeItem(context.Context, string) (models.KnowledgeItem, error)
}

type LookupInput struct { Term, Context string; Kind Kind }
type LookupResult struct { Source Source; Item models.KnowledgeItem }

func LookupVocabulary(ctx context.Context, store Store, provider agent.Provider, input LookupInput) (LookupResult, error)
```

Normalize with NFKC/trim/case-fold, enforce 80-rune term and 2,000-rune context limits, query exact local English item, call `KindWordWiki` only on `db.ErrNotFound`, validate output, and create an item whose ID is `vocab-` plus the first 16 hex characters of SHA-256 over kind and normalized term. On an insert conflict, read the deterministic ID and return it.

Run again; expected PASS.

- [ ] **Step 9: Write RED HTTP tests and register the route**

Test existing/generated response and strict rejection:

```go
response := requestJSON(t, router, http.MethodPost, "/api/knowledge/lookup", map[string]any{
    "term": "complicated", "context": "a complicated man", "kind": "word",
})
if response.Code != http.StatusCreated { t.Fatalf("status = %d: %s", response.Code, response.Body.String()) }
if !strings.Contains(response.Body.String(), `"source":"generated"`) { t.Fatalf("body = %s", response.Body.String()) }
```

Also assert `400` for blank term, unknown kind, overlong context, and unknown JSON fields; assert existing lookup returns `200`; assert missing provider returns `503` without creating a row.

Register before the dynamic `/{knowledgeID}` route:

```go
api.Post("/knowledge/lookup", func(w http.ResponseWriter, r *http.Request) {
    handleVocabularyLookup(w, r, application)
})
```

- [ ] **Step 10: Verify backend GREEN and commit/push Task 2**

Run:

```powershell
go test ./backend/agent ./backend/db ./backend/knowledge ./backend/httpapi -count=1
git add -- backend/agent/provider.go backend/agent/prompts.go backend/agent/mock.go backend/agent/mock_kinds_test.go backend/agent/provider_test.go backend/db/store.go backend/db/store_test.go backend/knowledge/vocabulary.go backend/knowledge/vocabulary_test.go backend/httpapi/vocabulary.go backend/httpapi/vocabulary_test.go backend/httpapi/router.go
git diff --cached --check
git commit -m "feat: resolve reading vocabulary with AI"
git push origin main
```

Expected: all focused Go packages PASS and only backend paths are committed.

### Task 3: Safe Markdown Preview and Vocabulary Buttons

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`
- Create: `frontend/src/features/reading/markdown-source.ts`
- Create: `frontend/src/features/reading/markdown-source.test.ts`
- Create: `frontend/src/features/reading/MarkdownPreview.tsx`
- Create: `frontend/src/features/reading/MarkdownPreview.test.tsx`

- [ ] **Step 1: Add GFM through the package manager**

Run:

```powershell
pnpm --dir frontend add remark-gfm
```

Expected: only `frontend/package.json` and `frontend/pnpm-lock.yaml` dependency metadata changes.

- [ ] **Step 2: Write RED normalization tests using the reference syntax**

```ts
import { normalizeReadingMarkdown } from "./markdown-source"

it("hides front matter and translates the supported Obsidian subset", () => {
  const source = [
    "---", "book: 1", "---", "# Title", "[[#结构速览|跳转]]",
    "> [!abstract] 导读", "> Body", '<span class="ody-ln">10</span>Line',
  ].join("\n")
  const result = normalizeReadingMarkdown(source)
  expect(result).not.toContain("book: 1")
  expect(result).toContain("[跳转](#结构速览)")
  expect(result).toContain('data-callout="abstract"')
  expect(result).toContain("〔10〕Line")
})
```

Add a separate test proving `<script>` and arbitrary `<img onerror>` remain escaped text.

- [ ] **Step 3: Verify RED, implement normalization, verify GREEN**

Run before implementation:

```powershell
pnpm --dir frontend exec vitest run src/features/reading/markdown-source.test.ts
```

Expected: FAIL because the module is missing.

Implement `normalizeReadingMarkdown(source: string): string` with anchored front-matter removal, wiki-link replacement, supported callout markers, and only the exact `ody-ln` span replacement. Do not add `rehype-raw`.

Run again; expected PASS.

- [ ] **Step 4: Write RED renderer tests**

Render `MarkdownPreview` with a small lexicon and assert:

```tsx
render(<MarkdownPreview markdown={markdown} entries={entries} onVocabularySelect={onSelect} />)
expect(screen.getByRole("table")).toBeInTheDocument()
expect(screen.getByRole("button", { name: "查词 at last" })).toHaveTextContent("At last")
expect(screen.getByText("const complicated = true")).not.toHaveAttribute("data-vocabulary-term")
fireEvent.click(screen.getByRole("button", { name: "查词 complicated" }))
expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ term: "complicated", context: expect.stringContaining("complicated man") }))
```

Also assert an ordinary link's label is not converted to a vocabulary button and arbitrary HTML does not create executable DOM.

- [ ] **Step 5: Verify RED, implement the renderer, verify GREEN**

Run before implementation:

```powershell
pnpm --dir frontend exec vitest run src/features/reading/MarkdownPreview.test.tsx
```

Expected: FAIL because `MarkdownPreview` is missing.

Implement the component with:

```ts
export interface VocabularySelection {
  term: string
  display: string
  kind: "word" | "expression"
  context: string
  anchor: HTMLElement
}

interface MarkdownPreviewProps {
  markdown: string
  entries?: readonly VocabularyLexiconEntry[]
  onVocabularySelect(selection: VocabularySelection): void
}
```

Use `ReactMarkdown` with `remarkGfm`, `remarkMath`, and `rehypeKatex`. Custom `p`, headings, list item, `td`, and `th` components tokenize string descendants with `createVocabularyMatcher`; custom `a`, `code`, and `pre` components leave descendants untouched. Render matches as real `button type="button"` controls with `data-vocabulary-term` and accessible `查词 <term>` names.

Run:

```powershell
pnpm --dir frontend exec vitest run src/features/reading/markdown-source.test.ts src/features/reading/MarkdownPreview.test.tsx src/lib/vocabulary-matcher.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit and push Task 3**

```powershell
git add -- frontend/package.json frontend/pnpm-lock.yaml frontend/src/features/reading/markdown-source.ts frontend/src/features/reading/markdown-source.test.ts frontend/src/features/reading/MarkdownPreview.tsx frontend/src/features/reading/MarkdownPreview.test.tsx
git diff --cached --check
git commit -m "feat: render safe vocabulary-aware markdown"
git push origin main
```

Expected: renderer commit is independent of page integration.

### Task 4: Lookup Client, Popover, and Split Workspace

**Files:**
- Modify: `frontend/src/api/knowledge.ts`
- Modify: `frontend/src/api/knowledge.test.ts`
- Create: `frontend/src/features/reading/VocabularyPopover.tsx`
- Create: `frontend/src/features/reading/VocabularyPopover.test.tsx`
- Create: `frontend/src/features/reading/MarkdownWorkspace.tsx`
- Create: `frontend/src/features/reading/MarkdownWorkspace.test.tsx`

- [ ] **Step 1: Write RED API client test**

```ts
await lookupVocabulary({ term: "at last", context: "At last, she answered.", kind: "expression" })
expect(mocks.apiRequest).toHaveBeenCalledWith("/knowledge/lookup", {
  method: "POST",
  body: JSON.stringify({ term: "at last", context: "At last, she answered.", kind: "expression" }),
})
```

- [ ] **Step 2: Verify RED, add typed client, verify GREEN**

Run before implementation:

```powershell
pnpm --dir frontend exec vitest run src/api/knowledge.test.ts
```

Expected: FAIL because `lookupVocabulary` is missing.

Add:

```ts
export interface VocabularyLookupInput { term: string; context: string; kind: "word" | "expression" }
export interface VocabularyLookupResponse { source: "existing" | "generated"; item: KnowledgeItem }
export function lookupVocabulary(input: VocabularyLookupInput): Promise<VocabularyLookupResponse>
```

Run again; expected PASS.

- [ ] **Step 3: Write RED popover tests for loading, cache, retry, and stale responses**

Use a controllable promise and assert:

```tsx
render(<VocabularyPopover selection={selection("complicated")} onClose={vi.fn()} />)
expect(screen.getByText("正在查询词义…")).toBeInTheDocument()
resolve({ source: "generated", item })
expect(await screen.findByText("复杂的；难懂的")).toBeInTheDocument()
expect(screen.getByRole("link", { name: "在知识库查看" })).toHaveAttribute("href", `/knowledge?item=${item.id}`)
```

Separate tests assert a failed request exposes `重试`, the second click reuses page cache, Escape closes, and a late first-term response cannot replace a newer selection.

- [ ] **Step 4: Verify RED, implement popover state machine, verify GREEN**

Run before implementation:

```powershell
pnpm --dir frontend exec vitest run src/features/reading/VocabularyPopover.test.tsx
```

Expected: FAIL because the component is missing.

Implement a module-level `Map<string, KnowledgeItem>` cache and request-version guard. Desktop renders an anchored `role="dialog"` panel constrained to viewport; `matchMedia("(max-width: 639px)")` switches to `DialogContent` with bottom-sheet classes. Keep retry explicit and never modify Reading state.

Run again; expected PASS.

- [ ] **Step 5: Write RED split-workspace tests**

Assert one controlled editor, one semantic preview, same source, and responsive container invariants:

```tsx
render(<MarkdownWorkspace markdown="# Title\nAt last." onMarkdownChange={onChange} />)
fireEvent.change(screen.getByLabelText("原文"), { target: { value: "# Changed" } })
expect(onChange).toHaveBeenCalledWith("# Changed")
expect(screen.getByRole("region", { name: "Markdown 实时预览" })).toHaveTextContent("At last.")
expect(screen.getByTestId("markdown-workspace")).toHaveClass("lg:grid-cols-2")
```

- [ ] **Step 6: Verify RED, implement split composition, verify GREEN**

`MarkdownWorkspace` owns `useDeferredValue(markdown)` and selected vocabulary state, while its caller owns persistence:

```tsx
export function MarkdownWorkspace({ markdown, onMarkdownChange }: {
  markdown: string
  onMarkdownChange(value: string): void
})
```

Use stable pane constraints (`min-h-64`, desktop `h-[clamp(24rem,56vh,42rem)]`), `overflow-auto` only on desktop preview/editor panes, and preserve the textarea's `aria-label="原文"`.

Run:

```powershell
pnpm --dir frontend exec vitest run src/api/knowledge.test.ts src/features/reading/VocabularyPopover.test.tsx src/features/reading/MarkdownWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit and push Task 4**

```powershell
git add -- frontend/src/api/knowledge.ts frontend/src/api/knowledge.test.ts frontend/src/features/reading/VocabularyPopover.tsx frontend/src/features/reading/VocabularyPopover.test.tsx frontend/src/features/reading/MarkdownWorkspace.tsx frontend/src/features/reading/MarkdownWorkspace.test.tsx
git diff --cached --check
git commit -m "feat: add contextual vocabulary popover"
git push origin main
```

### Task 5: Reading Integration, Knowledge Deep Link, and Browser Proof

**Files:**
- Modify: `frontend/src/pages/Reading.tsx`
- Modify: `frontend/src/pages/Reading.test.tsx`
- Modify: `frontend/src/pages/Knowledge.tsx`
- Modify: `frontend/src/pages/Knowledge.test.tsx`
- Create: `frontend/e2e/reading-markdown-vocabulary.spec.ts`

- [ ] **Step 1: Write RED Reading integration tests**

Mock `lookupVocabulary` alongside the existing `scheduleKnowledge` mock, paste Markdown, and assert:

```tsx
expect(screen.getByRole("region", { name: "Markdown 实时预览" })).toHaveTextContent("光合作用")
expect(screen.getAllByLabelText("原文")).toHaveLength(1)
expect(screen.getByRole("heading", { name: "结构" })).toBeInTheDocument()
expect(screen.getByRole("heading", { name: "正文" })).toBeInTheDocument()
```

Retain all existing Reading tests to prove shelf, marks, map, card, Ask, and focused-reader behaviors do not regress.

- [ ] **Step 2: Verify RED, replace only the top textarea, verify GREEN**

Run before implementation:

```powershell
pnpm --dir frontend exec vitest run src/pages/Reading.test.tsx
```

Expected: new preview assertion FAIL.

Replace the existing top `Textarea` with:

```tsx
<MarkdownWorkspace
  markdown={markdown}
  onMarkdownChange={(value) => save({ ...emptyReadingSession, markdown: value })}
/>
```

Keep map/card/archive controls in the same card and leave all code below the shelf unchanged. Run again; expected PASS.

- [ ] **Step 3: Write RED Knowledge deep-link tests**

Render at `/knowledge?item=k-complicated`, mock `getKnowledge`, and assert it requests and selects that ID even when the current list does not contain it:

```tsx
expect(mocks.getKnowledge).toHaveBeenCalledWith("k-complicated")
expect(await screen.findByRole("heading", { name: "complicated" })).toBeInTheDocument()
```

- [ ] **Step 4: Verify RED, implement query-driven selection, verify GREEN**

Use `useSearchParams()` and keep a requested ID from being overwritten by the first list response. Fetch it through the existing `getKnowledge` path and retain normal list selection after the user clicks a different row.

Run:

```powershell
pnpm --dir frontend exec vitest run src/pages/Knowledge.test.tsx src/pages/Reading.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write desktop/mobile Playwright workflow**

The spec must:

```ts
await page.goto("/reading")
await page.getByLabel("原文").fill("# Odyssey\n\nTell me about a complicated man.\n\nAt last, Athena answered.")
await expect(page.getByRole("region", { name: "Markdown 实时预览" })).toContainText("Odyssey")
await page.getByRole("button", { name: "查词 complicated" }).click()
await expect(page.getByText(/复杂|上下文释义/)).toBeVisible()
await expect(page.getByRole("heading", { name: "结构" })).toBeVisible()
await expect(page.getByRole("heading", { name: "正文" })).toBeVisible()
```

On desktop assert source and preview bounding boxes do not overlap and share a row; on mobile assert preview starts below editor and the vocabulary surface stays within the viewport. Follow the knowledge link and assert the same generated term is selected. Capture screenshots only through Playwright output paths.

- [ ] **Step 6: Run focused E2E and fix only test-proven failures**

Before running, stop only repository-owned processes on ports 8080/5174 after verifying executable/command paths; Playwright requires `reuseExistingServer: false`.

Run:

```powershell
pnpm --dir frontend exec playwright test e2e/reading-markdown-vocabulary.spec.ts
```

Expected: `2 passed` (desktop and mobile), no console/page errors.

- [ ] **Step 7: Run the full verification matrix**

```powershell
node --test scripts/tests/vocabulary-lexicon.test.mjs
go test ./... -count=1
pnpm --dir frontend exec vitest run --reporter=dot
pnpm --dir frontend exec tsc -b --pretty false
pnpm --dir frontend run build
pnpm --dir frontend exec eslint src/api/knowledge.ts src/features/reading src/lib/vocabulary-matcher.ts src/pages/Reading.tsx src/pages/Knowledge.tsx e2e/reading-markdown-vocabulary.spec.ts
pnpm --dir frontend exec playwright test
git diff --check
```

Expected: all commands exit `0`; existing English article wheel/hash E2E remains green.

- [ ] **Step 8: Commit and push Task 5**

```powershell
git add -- frontend/src/pages/Reading.tsx frontend/src/pages/Reading.test.tsx frontend/src/pages/Knowledge.tsx frontend/src/pages/Knowledge.test.tsx frontend/e2e/reading-markdown-vocabulary.spec.ts
git diff --cached --check
git commit -m "feat: integrate markdown vocabulary reading"
git push origin main
```

- [ ] **Step 9: Verify remote and protected-path history**

```powershell
git status --short
git rev-parse HEAD
git rev-parse origin/main
git ls-files docs prompt k.json
git log --oneline -5
```

Expected: `HEAD` equals `origin/main`; status contains at most `?? k.json`; no output from `git ls-files docs prompt k.json`; the five design/feature commits are visible in order.
