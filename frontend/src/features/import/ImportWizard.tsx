import { useMemo, useState } from "react"
import { CheckCircle2, FileSpreadsheet, RotateCcw, Upload } from "lucide-react"

import { commitImport, previewImport, uploadImport } from "@/api/imports"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

type UploadResult = Awaited<ReturnType<typeof uploadImport>>
type PreviewResult = Awaited<ReturnType<typeof previewImport>>
type CommitResult = Awaited<ReturnType<typeof commitImport>>
type ImportMapping = Record<string, string>
type Resolution = "merge" | "new_sense" | "reject"

const targetFields = [
  { key: "term", label: "单词", required: true },
  { key: "definition", label: "释义", required: true },
  { key: "item_type", label: "类型", required: false },
  { key: "part_of_speech", label: "词性", required: false },
  { key: "pronunciation", label: "发音", required: false },
  { key: "example", label: "例句", required: false },
  { key: "wiki", label: "百科", required: false },
  { key: "level", label: "等级", required: false },
  { key: "subject", label: "学科", required: false },
  { key: "tags", label: "标签", required: false },
] as const

const dispositionLabels: Record<string, string> = {
  insert: "直接导入",
  exact_duplicate: "精确重复",
  review: "需要确认",
  new_sense: "新义项",
  invalid: "无效行",
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function createInitialMapping(columns: string[]): ImportMapping {
  const mapping: ImportMapping = {}
  for (const field of targetFields) {
    const match = columns.find((column) => column.toLowerCase() === field.key)
    if (match) mapping[field.key] = match
  }
  return mapping
}

export function ImportWizard() {
  const [file, setFile] = useState<File | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [mapping, setMapping] = useState<ImportMapping>({})
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [commit, setCommit] = useState<CommitResult | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [pending, setPending] = useState<"upload" | "preview" | "commit" | null>(null)
  const [error, setError] = useState("")

  const inspection = uploadResult?.inspection
  const reviewRows = useMemo(
    () => preview?.rows.filter((row) => row.disposition === "review") ?? [],
    [preview],
  )

  async function uploadSelectedFile(table?: string) {
    if (!file || pending) return
    setPending("upload")
    setError("")
    setPreview(null)
    setCommit(null)
    try {
      const result = table ? await uploadImport(file, table) : await uploadImport(file)
      setUploadResult(result)
      setMapping(createInitialMapping(result.inspection.columns))
    } catch (reason) {
      setError(errorMessage(reason, "文件未能上传，请重试。"))
    } finally {
      setPending(null)
    }
  }

  async function buildPreview() {
    if (!uploadResult || pending) return
    if (!mapping.term || !mapping.definition) {
      setError("请选择「单词」和「释义」的源列。")
      return
    }
    setPending("preview")
    setError("")
    setCommit(null)
    try {
      const result = await previewImport(uploadResult.job_id, mapping)
      setPreview(result)
      setResolutions({})
    } catch (reason) {
      setError(errorMessage(reason, "预览生成失败，请检查字段映射。"))
    } finally {
      setPending(null)
    }
  }

  async function commitRows() {
    if (!uploadResult || !preview || pending) return
    setPending("commit")
    setError("")
    try {
      setCommit(await commitImport(uploadResult.job_id, { resolutions }))
    } catch (reason) {
      setError(errorMessage(reason, "导入未能提交，请重试。"))
    } finally {
      setPending(null)
    }
  }

  function reset() {
    setFile(null)
    setUploadResult(null)
    setMapping({})
    setPreview(null)
    setCommit(null)
    setResolutions({})
    setPending(null)
    setError("")
  }

  return (
    <Card>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>导入向导</CardTitle>
            <CardDescription className="mt-1">上传 → 映射 → 预览 → 提交</CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="导入进度">
            <Badge variant={uploadResult ? "default" : "secondary"}>1 上传</Badge>
            <Badge variant={preview ? "default" : "secondary"}>2 预览</Badge>
            <Badge variant={commit ? "default" : "secondary"}>3 完成</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 pt-2">
        {error ? <p role="alert" className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        <p className="sr-only" aria-live="polite">
          {pending === "upload" ? "正在上传文件" : pending === "preview" ? "正在生成预览" : pending === "commit" ? "正在提交导入" : ""}
        </p>

        {!uploadResult ? (
          <section className="grid gap-4">
            <div className="grid min-h-44 place-items-center gap-3 rounded-xl border border-dashed bg-muted/20 p-6 text-center">
              <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><FileSpreadsheet aria-hidden="true" /></div>
              <div>
                <p className="font-medium">选择 CSV、JSONL 或 SQLite 文件</p>
                <p className="mt-1 text-sm text-muted-foreground">单个文件不超过 25 MiB；源行会保留以便追溯。</p>
              </div>
              <input
                type="file"
                aria-label="选择导入文件"
                accept=".csv,.jsonl,.ndjson,.sqlite,.sqlite3,.db"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block max-w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium"
              />
            </div>
            <Button disabled={!file || pending !== null} onClick={() => void uploadSelectedFile()}>
              <Upload data-icon="inline-start" />{pending === "upload" ? "正在上传…" : "上传文件"}
            </Button>
          </section>
        ) : null}

        {inspection && !preview ? (
          <section className="grid gap-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">格式</p><p className="mt-1 font-medium uppercase">{inspection.format}</p></div>
              <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">数据行</p><p className="mt-1 font-medium">{inspection.row_count}</p></div>
              <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">字段数</p><p className="mt-1 font-medium">{inspection.columns.length}</p></div>
            </div>

            {inspection.format === "sqlite" && inspection.tables.length > 0 ? (
              <label className="grid gap-2 text-sm font-medium" htmlFor="import-table">
                数据表
                <select
                  id="import-table"
                  value={inspection.selected_table ?? ""}
                  disabled={pending !== null}
                  onChange={(event) => void uploadSelectedFile(event.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">选择数据表</option>
                  {inspection.tables.map((table) => <option key={table} value={table}>{table}</option>)}
                </select>
              </label>
            ) : null}

            <section className="grid gap-3">
              <div>
                <h2 className="font-heading text-lg font-medium">字段映射</h2>
                <p className="text-sm text-muted-foreground">term 与 definition 必填；其他字段可以留空。</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {targetFields.map((field) => (
                  <label key={field.key} className="grid gap-1.5 text-sm font-medium" htmlFor={`mapping-${field.key}`}>
                    <span>{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</span>
                    <select
                      id={`mapping-${field.key}`}
                      aria-label={`${field.label} 源列`}
                      value={mapping[field.key] ?? ""}
                      onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.target.value }))}
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">不映射</option>
                      {inspection.columns.map((column) => <option key={column} value={column}>{column}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </section>

            {inspection.sample_rows.length > 0 ? (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">查看抽样数据</summary>
                <pre className="mt-3 max-h-52 overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(inspection.sample_rows, null, 2)}</pre>
              </details>
            ) : null}

            <Button disabled={pending !== null} onClick={() => void buildPreview()}>{pending === "preview" ? "正在预览…" : "预览导入"}</Button>
          </section>
        ) : null}

        {preview && !commit ? (
          <section className="grid gap-5">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="预览汇总">
              {(["insert", "exact_duplicate", "review", "new_sense", "invalid"] as const).map((key) => (
                <div key={key} className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{key}</p>
                  <p className="mt-1 text-xl font-semibold">{preview.summary[key]}</p>
                </div>
              ))}
              <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">rows</p><p className="mt-1 text-xl font-semibold">{preview.summary.rows}</p></div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2">行</th><th className="px-3 py-2">知识点</th><th className="px-3 py-2">定义</th><th className="px-3 py-2">处理</th></tr></thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row_id} className="border-t align-top">
                      <td className="px-3 py-3">{row.row_number}</td>
                      <td className="px-3 py-3 font-medium">{row.normalized?.term || "—"}</td>
                      <td className="px-3 py-3 text-muted-foreground">{row.normalized?.definition || row.error || "—"}</td>
                      <td className="px-3 py-3">
                        <Badge variant={row.disposition === "invalid" ? "destructive" : row.disposition === "review" ? "default" : "secondary"}>{dispositionLabels[row.disposition] ?? row.disposition}</Badge>
                        {row.disposition === "review" ? (
                          <select
                            aria-label={`第 ${row.row_number} 行处理方式`}
                            value={resolutions[row.row_id] ?? ""}
                            onChange={(event) => {
                              const resolution = event.target.value
                              setResolutions((current) => {
                                const next = { ...current }
                                if (resolution) next[row.row_id] = resolution as Resolution
                                else delete next[row.row_id]
                                return next
                              })
                            }}
                            className="mt-2 block h-8 rounded-lg border border-input bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="">保留为待复审</option>
                            <option value="merge">合并到现有知识点</option>
                            <option value="new_sense">作为新义项导入</option>
                            <option value="reject">拒绝这一行</option>
                          </select>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {reviewRows.length > 0 ? <p className="text-sm text-muted-foreground">有 {reviewRows.length} 行需要确认；未选择的行会保留为待复审。</p> : null}
            <Button disabled={pending !== null} onClick={() => void commitRows()}>{pending === "commit" ? "正在提交…" : "提交导入"}</Button>
          </section>
        ) : null}

        {commit ? (
          <section className="grid gap-5 text-center" aria-live="polite">
            <CheckCircle2 aria-hidden="true" className="mx-auto size-12 text-primary" />
            <div>
              <h2 className="font-heading text-2xl font-medium">导入完成</h2>
              <p className="mt-2 text-muted-foreground">{`已导入 ${commit.summary.inserted} 条知识点，生成 ${commit.summary.prompts_created} 个记忆提示。`}</p>
            </div>
            <div className="mx-auto grid w-full max-w-2xl gap-2 sm:grid-cols-3">
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">精确重复</p><p className="mt-1 text-xl font-semibold">{commit.summary.exact_duplicates}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">已合并</p><p className="mt-1 text-xl font-semibold">{commit.summary.merged}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">待处理</p><p className="mt-1 text-xl font-semibold">{commit.summary.pending_reviews}</p></div>
            </div>
          </section>
        ) : null}
      </CardContent>

      {uploadResult ? (
        <CardFooter className="justify-between gap-3">
          <span className="text-xs text-muted-foreground">任务 {uploadResult.job_id}</span>
          <Button variant="outline" size="sm" disabled={pending !== null} onClick={reset}><RotateCcw data-icon="inline-start" />重新开始</Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}
