# Error Cause Taxonomy Design

## Goal

Turn mistake causes from a frontend-only six-item constant into a persisted,
subject-aware taxonomy without deleting historical free-text causes. The first
slice must let the system add a category, confirm it, use it for later mistake
capture and diagnosis, and reclassify an existing mistake.

## Constraints

- Keep the existing cause IDs (`recall`, `misread`, `careless`, `method`,
  `time`, `unknown`) so persisted attempts and old clients remain readable.
- Do not add a foreign key from `question_attempts.cause`. Prompt 0801 permits
  free text before a stable category exists, and old databases may already
  contain values outside the default six.
- A category created by automation starts as `candidate`. Only `confirmed`
  categories may be offered for capture, used for reclassification, or grant
  access to mistake scheduling.
- Category IDs are globally unique. Subject-specific IDs may use a stable
  namespace such as `geography:condition-scope`; an attempt still stores one
  unambiguous string.
- Category configuration is public application data, not a secret. Source
  pointers record where a proposed classification came from.

## Persisted Object

Schema v16 adds `error_causes`:

| Column | Meaning |
|---|---|
| `id` | Stable global ID stored in `question_attempts.cause` |
| `subject` | Empty for global categories; otherwise one subject ID |
| `parent_id` | Optional parent category for subject-specific refinement |
| `label` | Learner-facing short name |
| `review_fixes` | Whether spaced review is an appropriate intervention |
| `action` | Concrete next action shown after diagnosis |
| `status` | `candidate`, `confirmed`, or `archived` |
| `source_type` / `source_id` | Optional provenance for a proposed category |
| `sort_order` | Stable display order |
| timestamps | Creation and last update time |

The migration and fresh schema both seed the current six categories as global,
confirmed rows. Only `recall` has `review_fixes = true`.

## Store Contract

- `ListErrorCauses(subject, status)` returns global rows plus rows for the
  requested subject. Operational callers request `confirmed`; management may
  request `candidate`, `archived`, or all statuses.
- `CreateErrorCause` validates ID, scope, status, label, and parent scope. An
  empty status becomes `candidate`.
- `UpdateErrorCause` changes mutable presentation, parent, provenance,
  intervention, ordering, and status fields. ID and subject are immutable.
- `ReclassifyMistake` accepts only a confirmed category whose subject is empty
  or matches the mistake question's subject.
- `ErrorCauseReviewFixes` uses the persisted confirmed category. An unknown,
  candidate, archived, or wrong-subject value is not review-fixable.

## HTTP Contract

- `GET /api/error-causes?subject=physics&status=confirmed`
- `POST /api/error-causes` creates a candidate category and returns `201`.
- `PATCH /api/error-causes/{causeID}` confirms, archives, or edits a category.
- `PATCH /api/mistakes/{attemptID}/cause` reclassifies one filed attempt.

Invalid input returns `400`, missing rows return `404`, and duplicate IDs return
`409`. IDs in paths are URL-encoded by clients.

## Frontend Contract

The Practice page loads confirmed global and current-subject categories. It
retains the checked-in six-category list as an offline/older-backend fallback,
but no longer drops a mistake whose cause is unknown. Unknown free text renders
as a conservative `reviewFixes: false` category marked for later classification.

Summaries accept the loaded taxonomy as input, so subject-specific categories
participate in counts and recommendations. Existing subject-specific drawing
boards remain keyed to the legacy IDs; a new category without a board still
gets its persisted action text.

## Static Pages

The static adapter owns an in-memory copy of the same defaults and supports
list, create, update, and reclassification. This keeps the GitHub Pages build
backend-free while exercising the same interaction contract.

## Non-Goals

- Inventing the names of the geography six causes; the supplied prompts say
  they exist but do not define them.
- Automatically reclassifying historical free text with AI.
- A full taxonomy administration screen in this slice.
- Adding a generalized analytics dashboard before real category data exists.
