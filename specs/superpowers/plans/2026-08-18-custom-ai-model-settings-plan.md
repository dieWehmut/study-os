# Custom AI Model Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every configured AI vendor accept arbitrary chat and reasoning model names while retaining the vendor's current models as input suggestions.

**Architecture:** Keep the existing `VendorConfigInput` API and backend unchanged. Replace only the two model `Select` controls in `SettingsPanel` with controlled `Input` elements backed by a vendor-scoped native `datalist`, then trim non-empty drafts before calling the existing settings store action.

**Tech Stack:** React 19, TypeScript, Base UI-backed local `Input`, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify `frontend/src/features/settings/SettingsPanel.test.tsx`: specify editable custom-model behavior, vendor-specific suggestions, and the no-suggestion input case.
- Modify `frontend/src/features/settings/SettingsPanel.tsx`: render editable model inputs, build native suggestions, and trim saved values.
- No backend changes: `backend/httpapi/agent.go` already accepts and trims arbitrary model strings.

### Task 1: Add failing editable-model regression coverage

**Files:**
- Test: `frontend/src/features/settings/SettingsPanel.test.tsx:186`

- [ ] **Step 1: Rewrite the existing API-key/model test for an editable reasoning-model input**

Replace the select-popup interaction in `saves an API key and model through the vendor config form without echoing the key` with:

```tsx
const reasoningModelInput = screen.getByLabelText("推理模型")
expect(reasoningModelInput).toHaveAttribute("list", "deepseek-model-options")
fireEvent.change(reasoningModelInput, { target: { value: "deepseek-v4-pro" } })
```

Keep the existing save click and request assertion:

```tsx
await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
  provider: "deepseek",
  api_key: "sk-live-secret",
  reasoning_model: "deepseek-v4-pro",
}))
```

- [ ] **Step 2: Rewrite the Claude test to inspect only Claude's datalist suggestions**

Replace the popup-option assertions in `configures Claude with its own models rather than the active vendor's` with:

```tsx
const modelInput = screen.getByLabelText("模型")
expect(modelInput).toHaveAttribute("list", "claude-model-options")
const suggestions = Array.from(
  document.querySelectorAll<HTMLOptionElement>("#claude-model-options option"),
).map((option) => option.value)
expect(suggestions).toEqual(["claude-sonnet-4-6", "claude-opus-4-6"])
expect(suggestions).not.toContain("deepseek-v4-flash")
fireEvent.change(modelInput, { target: { value: "claude-opus-4-6" } })
```

Keep the existing request assertion for `provider`, `api_key`, and `model`.

- [ ] **Step 3: Add a test for arbitrary model names and whitespace trimming**

Add after the API-key/model test:

```tsx
it("saves custom chat and reasoning model names outside the vendor suggestions", async () => {
  render(<SettingsPanel />)

  fireEvent.click(await screen.findByRole("button", { name: "编辑 DeepSeek 配置" }))
  const modelInput = screen.getByLabelText("模型")
  const reasoningModelInput = screen.getByLabelText("推理模型")

  expect(modelInput).toHaveAttribute("list", "deepseek-model-options")
  fireEvent.change(modelInput, { target: { value: "  openrouter/custom-chat:v3  " } })
  fireEvent.change(reasoningModelInput, { target: { value: "  private/reasoner:latest  " } })
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }))

  await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
    provider: "deepseek",
    model: "openrouter/custom-chat:v3",
    reasoning_model: "private/reasoner:latest",
  }))
})
```

- [ ] **Step 4: Add a test that whitespace-only model drafts are omitted**

Add:

```tsx
it("omits model fields that contain only whitespace", async () => {
  render(<SettingsPanel />)

  fireEvent.click(await screen.findByRole("button", { name: "编辑 DeepSeek 配置" }))
  const modelInput = screen.getByLabelText("模型")
  const reasoningModelInput = screen.getByLabelText("推理模型")

  expect(modelInput).toHaveAttribute("list", "deepseek-model-options")
  fireEvent.change(modelInput, { target: { value: "   " } })
  fireEvent.change(reasoningModelInput, { target: { value: "  " } })
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }))

  await waitFor(() => expect(mocks.saveVendorConfig).toHaveBeenCalledWith({
    provider: "deepseek",
  }))
})
```

- [ ] **Step 5: Add a test that inputs remain available without suggestions**

Add:

```tsx
it("keeps model inputs editable when a vendor reports no suggestions", async () => {
  mocks.getVendors.mockResolvedValueOnce({
    active_provider: "custom",
    items: [{
      id: "custom",
      display_name: "自定义服务",
      implemented: true,
      key_configured: true,
      base_url: "http://127.0.0.1:9000/v1",
      active: true,
    }],
  })
  render(<SettingsPanel />)

  fireEvent.click(await screen.findByRole("button", { name: "编辑 自定义服务 配置" }))

  expect(screen.getByLabelText("模型")).toBeInTheDocument()
  expect(screen.getByLabelText("推理模型")).toBeInTheDocument()
})
```

- [ ] **Step 6: Run the focused test and verify RED**

Run from `frontend`:

```powershell
pnpm test --run src/features/settings/SettingsPanel.test.tsx
```

Expected: FAIL because the existing model controls are Base UI select triggers without `list` attributes, and the no-model vendor renders no model controls.

- [ ] **Step 7: Commit the red tests only**

```powershell
git add -- frontend/src/features/settings/SettingsPanel.test.tsx
git diff --cached --check
git commit -m "test: cover editable AI model settings"
```

### Task 2: Implement editable model inputs

**Files:**
- Modify: `frontend/src/features/settings/SettingsPanel.tsx:176`
- Modify: `frontend/src/features/settings/SettingsPanel.tsx:717`
- Test: `frontend/src/features/settings/SettingsPanel.test.tsx`

- [ ] **Step 1: Trim the model drafts before building the save request**

Change `saveVendorSettings` to:

```tsx
async function saveVendorSettings(vendorID: string) {
  const values: VendorConfigInput = { provider: vendorID }
  const model = modelDraft.trim()
  const reasoningModel = reasoningModelDraft.trim()
  if (apiKeyDraft.trim()) values.api_key = apiKeyDraft.trim()
  if (baseURLDraft.trim()) values.base_url = baseURLDraft.trim()
  if (model) values.model = model
  if (reasoningModel) values.reasoning_model = reasoningModel
  await saveConfig(vendorID, values)
  setApiKeyDraft("")
  setOpenConfig(null)
}
```

- [ ] **Step 2: Derive a unique suggestion list per vendor**

Inside `vendors.map`, replace `modelOptions` with:

```tsx
const models = Array.from(new Set(vendor.models ?? []))
const modelSuggestionsID = `${vendor.id}-model-options`
const defaultModel = models[0] ?? ""
const defaultReasoningModel = models[1] ?? defaultModel
```

Update the nearby comment to describe suggestions rather than select options. Use
the same deduplicated `models` collection for the visible model badges so repeated
backend slots cannot create duplicate React keys.

- [ ] **Step 3: Replace both model Select controls with editable inputs and a datalist**

Replace the conditional `{modelOptions.length > 0 ? (...) : null}` block with:

```tsx
<div className="grid grid-cols-2 gap-2">
  <label className="grid gap-1 text-xs font-medium" htmlFor={`${vendor.id}-model`}>
    模型
    <Input
      id={`${vendor.id}-model`}
      type="text"
      aria-label="模型"
      list={modelSuggestionsID}
      value={modelDraft}
      onChange={(event) => setModelDraft(event.target.value)}
      placeholder={defaultModel ? `默认（${defaultModel}）` : "输入模型名称"}
      className="font-mono text-xs"
    />
  </label>
  <label className="grid gap-1 text-xs font-medium" htmlFor={`${vendor.id}-reasoning-model`}>
    推理模型
    <Input
      id={`${vendor.id}-reasoning-model`}
      type="text"
      aria-label="推理模型"
      list={modelSuggestionsID}
      value={reasoningModelDraft}
      onChange={(event) => setReasoningModelDraft(event.target.value)}
      placeholder={defaultReasoningModel ? `默认（${defaultReasoningModel}）` : "输入推理模型名称"}
      className="font-mono text-xs"
    />
  </label>
  <datalist id={modelSuggestionsID}>
    {models.map((model) => <option key={model} value={model} />)}
  </datalist>
</div>
```

Keep the shared `Select` import because the speech preset controls in this file still use it.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run from `frontend`:

```powershell
pnpm test --run src/features/settings/SettingsPanel.test.tsx
```

Expected: PASS for the full `SettingsPanel` test file with no React warnings.

- [ ] **Step 5: Run TypeScript/build verification for the component change**

Run from `frontend`:

```powershell
pnpm build
```

Expected: exit code 0; TypeScript accepts the native `datalist` and `Input` props, and Vite builds the frontend.

- [ ] **Step 6: Commit the implementation**

```powershell
git add -- frontend/src/features/settings/SettingsPanel.tsx
git diff --cached --check
git commit -m "feat: allow custom AI model names"
```

### Task 3: Verify the AI settings increment

**Files:**
- Verify only; do not modify unrelated files.

- [ ] **Step 1: Re-run focused tests from a clean index state**

```powershell
Set-Location frontend
pnpm test --run src/features/settings/SettingsPanel.test.tsx
```

Expected: all tests in the file pass.

- [ ] **Step 2: Run lint for the frontend**

```powershell
pnpm lint
```

Expected: exit code 0 with no ESLint errors.

- [ ] **Step 3: Confirm only the user's untracked file remains**

From repository root:

```powershell
Set-Location ..
git diff --check
git status --short
```

Expected status at this checkpoint: only `?? k.json`.
