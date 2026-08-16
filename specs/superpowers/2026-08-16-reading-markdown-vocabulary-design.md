# Reading Markdown Workspace and Vocabulary Lookup

## Status

Approved design. The implementation must preserve the existing Reading session,
structure preview, focused reader, shelf, and the existing English-article hash
route behavior.

## Goal

Change the top `阅读` workspace into a live Markdown split view:

- desktop: Markdown source on the left and rendered Markdown on the right;
- mobile: source above rendered preview;
- the current lower `结构` and `正文` workflow remains available and uses the
  same source text;
- words and multi-word expressions from the two ignored MOC reference files are
  highlighted in the rendered preview;
- clicking a highlight shows a compact vocabulary popover and generates a saved
  knowledge item on demand when no local item exists.

The reference article's front matter, Obsidian links, callouts, tables, and line
number spans should remain readable in the preview. The source editor always
retains the user's original Markdown.

## Non-goals

- Do not replace the existing focused, one-section reader or its progress marks.
- Do not automatically generate or schedule vocabulary while the user types.
- Do not expose arbitrary raw HTML from pasted Markdown.
- Do not change the existing English-article detail URL/hash synchronization.
- Do not track `docs/`, the ignored `prompt/` sources, generated visual mockups,
  or `k.json`.

## Page Structure

`Reading` keeps one source of truth: `ReadingSession.markdown`. A new
`MarkdownWorkspace` receives that value and the existing `onMarkdownChange`
callback. Its top card contains two labelled panes:

1. `MarkdownEditor`: a controlled textarea with the current source.
2. `MarkdownPreview`: a deferred rendering of the same source.

On desktop the panes use equal, stable height and independent scrolling. They do
not attempt line-for-line scroll synchronisation because tables, callouts, and
wrapped lines make source and output heights non-deterministic. On narrow
screens the panes stack, the editor keeps a bounded editing height, and the
preview follows normal page flow. Existing map, information-card, shelf, and
archive controls remain below the split card. Existing structure and focused
reader components continue to derive from the same `markdown` value.

Changing the source follows the current session semantics: it replaces the
document and clears position/read/stuck/kept marks. Preview rendering is
deferred with React's concurrent value utilities so typing a long article stays
responsive; the source is never changed by preview rendering.

## Reference Lexicon

The two ignored sources are:

- `prompt/00-MOC.md` (single-word index);
- `prompt/00-MOC (1).md` (multi-word expression index).

`scripts/build-vocabulary-lexicon.mjs` accepts those paths and emits a compact,
tracked `frontend/src/generated/vocabulary-lexicon.ts`. The generated data
contains a normalized term, display term, aliases, and a coarse kind (`word` or
`expression`). The script fails with a file/line error for malformed wiki-link
entries. It is a developer regeneration command, not part of the production
startup path; the application uses the checked-in generated result because the
source files are intentionally ignored.

The matcher builds a trie once per lexicon and scans visible text nodes with
longest-match-first behavior. Matching is case-insensitive and uses English word
boundaries. It does not stem words, so only forms present in the reference
lexicon match. It skips code/pre nodes, link destinations, existing links,
line-number markers, and generated vocabulary controls. Repeated occurrences
reuse the same normalized lookup key.

## Markdown Rendering

`MarkdownPreview` uses the existing React Markdown, math, and KaTeX stack plus
GFM support. A preprocessing/remark layer implements the safe subset needed by
the reference article:

- YAML front matter is removed from rendered output but not from the editor;
- `[[target|label]]` displays `label` and same-document anchors remain
  navigable; cross-document links are rendered as inert, readable text;
- `> [!type]` and `> [!type]-` become labelled callouts/details;
- `<span class="ody-ln">N</span>` becomes a non-interactive line-number marker;
- all other raw HTML is escaped/omitted rather than executed.

The renderer adds stable semantic attributes to vocabulary marks and headings so
the popover and focused tests do not depend on visual class names.

## Vocabulary Lookup Contract

Add:

```http
POST /api/knowledge/lookup
Content-Type: application/json
```

Request:

```json
{
  "term": "complicated",
  "context": "Tell me about a complicated man.",
  "kind": "word"
}
```

`term` is required and limited to a normalized English word/expression; `kind`
is `word` or `expression`; `context` is optional but limited to the selected
sentence (at most 2,000 characters). The response is:

```json
{
  "source": "existing",
  "item": {
    "id": "...",
    "item_type": "word_sense",
    "term": "complicated",
    "part_of_speech": "adjective",
    "pronunciation": "...",
    "concise_definition": "复杂的；难懂的",
    "detailed_markdown": "...",
    "example": "...",
    "subject": "english",
    "tags": ["english", "reading-vocabulary"]
  }
}
```

The server first performs an exact, normalized English-term lookup. If no item
exists, it calls the active provider in a lookup-capable `word_wiki` mode,
passing the term and context, validates the returned concise definition and
Markdown, then stores one `word_sense`/expression item with English and
`reading-vocabulary` tags. The operation is idempotent: it rechecks before
insert and treats a concurrent uniqueness conflict as a read of the winner.
Generated items are not automatically scheduled for review.

The Agent contract changes are backwards-compatible for existing callers:
`WordWikiInput.Definition` becomes optional when context is supplied and gains a
context field; `WordWikiOutput` gains optional part of speech, pronunciation,
and example fields. Existing definition-provided word-wiki requests keep their
current validation and output behavior.

## Popover Behavior

`VocabularyPopover` is controlled by the selected normalized term and anchor
rectangle. On desktop it is an anchored floating panel; on narrow screens it
uses the existing Dialog primitive as a bottom-oriented sheet. It has:

- term and reference-match label;
- loading state while local lookup or AI generation runs;
- pronunciation, part of speech, concise definition, and example when present;
- a link to `/knowledge?item=<id>` for the full wiki;
- retry action for recoverable failures;
- Escape/outside-click close and keyboard focus management.

Lookup results are cached per normalized term for the lifetime of the page.
Stale responses are ignored after close or selection changes. A failed lookup
never mutates the Markdown or ReadingSession.

## Error Handling and Safety

- Invalid lookup payloads return `400` with a stable user-facing error message.
- Missing provider, timeout, or malformed model output returns a retryable
  service error; no partial database row is written.
- Existing local items are usable even when the provider is offline.
- Context and term are length-limited and treated as data, not Markdown/HTML.
- The preview never enables arbitrary pasted event handlers or scripts.

## Verification

Pure/frontend tests cover:

- MOC extraction, aliases, type mapping, and generated-lexicon drift;
- longest phrase matching, word boundaries, repeated terms, and skipped code/
  links;
- front matter, GFM table, callout, wiki-link, line-number, and safe-HTML
  rendering;
- split-pane source updates, session reset semantics, popover loading/cache/
  retry, and mobile dialog behavior;
- Knowledge-page `?item=` deep selection.

Backend tests cover:

- lookup validation and exact existing-item response;
- provider generation with context and strict output validation;
- generated-item persistence, tags, and concurrent duplicate handling;
- no-provider, timeout, malformed-output, and database-failure responses.

Before each push run focused tests for the changed layer, then frontend Vitest,
Go tests, TypeScript/build, ESLint, and desktop/mobile Playwright coverage for
editing, rendered preview, vocabulary lookup, and the preserved lower reader.

## Commit and Push Order

1. `docs`-free design/spec only; review and push it before implementation.
2. Lexicon extractor, generated data, and pure matcher tests.
3. Backend Agent lookup contract, persistence service, and HTTP tests.
4. Frontend Markdown renderer and vocabulary popover tests.
5. Reading integration, responsive styling, E2E coverage, and final cleanup.

Each commit is staged by explicit path (never `git add .`), verified, and pushed
to `origin/main` before starting the next step. `k.json` remains untracked.
