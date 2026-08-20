# Mistake Correction Evidence Design

## Goal

把练习页的“订正”从一个无内容点击升级为可追溯的作答证据。系统需要知道学习者订正时实际写了什么、用了多久、结果是否正确，而不是仅凭一个空 `cause` 行推断已经掌握。

## Product Boundary

- 初次记错题继续保持低负担：题干 + 错因即可保存，答案和耗时是可选证据，不增加必填步骤。
- 订正必须填写答案；从展开订正输入框开始计时，提交后保存答案、耗时和 `is_correct=true`。
- 本切片不做 AI 判题。用户点击“提交订正”就是确认这次答案已经核对正确；未来可在同一 attempt 上增加自动或人工评价来源。
- 订正不会删除原错题，也不会自动改变 FSRS。原错误与后续正确作答都保留在同一题目的 attempt 历史里。
- 同一错题重复调用订正接口保持幂等：返回已有正确 attempt，不制造多条相同的“已订正”证据。

## Persistence

Schema v15 extends `question_attempts`:

- `answer TEXT NOT NULL DEFAULT ''`
- `elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_ms >= 0)`
- `is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1))`

Migration rules:

- Existing rows with a non-empty cause remain incorrect.
- Existing cause-less retry rows become correct, preserving the old corrected state.

`QuestionAttempt` exposes `answer`, `elapsed_ms`, and `is_correct`. `Mistake` exposes the latest correct attempt as optional `correction`; `corrected` remains as a compatibility summary derived from that attempt.

## API

`POST /api/mistakes/{attemptID}/correct`

Request:

```json
{"answer":"6 N","elapsed_ms":4200}
```

Validation:

- `answer` is trimmed and required.
- `elapsed_ms` must be non-negative.
- Missing mistake returns 404.

Response remains the `Mistake` pair and additionally includes `correction`.

`POST /api/mistakes` may accept optional `answer` and `elapsed_ms` for future capture clients, but the current quick-capture UI does not require them.

## Frontend

- Pressing `订正` opens an inline form for that row and focuses an answer input.
- The timer starts when the form opens, not when the page loaded.
- `取消` closes the form without a request.
- `提交订正` calls the evidence-aware API and keeps the row visible.
- A corrected row displays `订正答案` and a compact elapsed-time label when available.
- Failed saves keep the answer in the input and leave the form usable.

## Static Pages

The static adapter implements the same request validation and stores the correction attempt in memory. Evidence survives hash-route navigation in the same document and resets on a full reload, matching the rest of the Pages demo.

## Verification

- Migration and fresh-schema tests cover all three columns and legacy correction conversion.
- Store/HTTP tests prove answer trimming, elapsed validation, idempotency, and correction projection.
- Frontend tests prove the inline form, payload, persistence failure behavior, and rendered evidence.
- Static adapter and Pages smoke prove the frontend-only deployment completes the same flow without `/api` traffic.
