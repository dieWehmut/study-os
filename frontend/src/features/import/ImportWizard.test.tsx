import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ImportWizard } from "./ImportWizard"

const mocks = vi.hoisted(() => ({
  commitImport: vi.fn(),
  previewImport: vi.fn(),
  uploadImport: vi.fn(),
}))

vi.mock("@/api/imports", () => mocks)

const inspection = {
  format: "csv",
  tables: [],
  selected_table: "",
  columns: ["word", "meaning", "details"],
  sample_rows: [{ word: "abandon", meaning: "放弃", details: "Leave behind." }],
  row_count: 2,
}

describe("ImportWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadImport.mockResolvedValue({ job_id: "job-1", inspection })
    mocks.previewImport.mockResolvedValue({
      job_id: "job-1",
      state: "previewed",
      mapping: { term: "word", definition: "meaning", wiki: "details" },
      summary: { rows: 2, insert: 1, exact_duplicate: 0, review: 1, new_sense: 0, invalid: 0 },
      rows: [
        {
          row_id: "row-1",
          row_number: 1,
          raw: { word: "abandon", meaning: "放弃" },
          normalized: { term: "abandon", definition: "放弃" },
          disposition: "insert",
        },
        {
          row_id: "row-2",
          row_number: 2,
          raw: { word: "abandon", meaning: "舍弃" },
          normalized: { term: "abandon", definition: "舍弃" },
          disposition: "review",
          matched_knowledge_item_id: "k-existing",
        },
      ],
    })
    mocks.commitImport.mockResolvedValue({
      job_id: "job-1",
      state: "committed",
      summary: { inserted: 1, exact_duplicates: 0, merged: 0, pending_reviews: 0, rejected: 0, prompts_created: 3 },
    })
  })

  it("uploads a file, validates mapping, previews dispositions, and commits", async () => {
    const { container } = render(<ImportWizard />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(["word,meaning,details\nabandon,放弃,Leave behind."], "words.csv", { type: "text/csv" })

    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(await screen.findByRole("button", { name: "上传文件" }))
    await waitFor(() => expect(mocks.uploadImport).toHaveBeenCalledWith(file))

    fireEvent.click(screen.getByRole("button", { name: "预览导入" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("请选择「单词」和「释义」的源列")

    fireEvent.change(screen.getByLabelText("单词 源列"), { target: { value: "word" } })
    fireEvent.change(screen.getByLabelText("释义 源列"), { target: { value: "meaning" } })
    fireEvent.change(screen.getByLabelText("百科 源列"), { target: { value: "details" } })
    fireEvent.click(screen.getByRole("button", { name: "预览导入" }))

    expect(await screen.findByText("exact_duplicate")).toBeInTheDocument()
    expect(screen.getByText("review")).toBeInTheDocument()
    const resolution = screen.getByLabelText("第 2 行处理方式")
    expect(resolution).toHaveValue("")
    fireEvent.change(resolution, { target: { value: "merge" } })
    fireEvent.click(screen.getByRole("button", { name: "提交导入" }))

    expect(await screen.findByText(/已导入 1 条知识点/)).toBeInTheDocument()
    expect(mocks.commitImport).toHaveBeenCalledWith("job-1", { resolutions: { "row-2": "merge" } })
  })

  it("shows a usable error when upload fails", async () => {
    mocks.uploadImport.mockRejectedValueOnce(new Error("文件超过 25 MiB"))
    const { container } = render(<ImportWizard />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["x"], "words.csv")] } })
    fireEvent.click(await screen.findByRole("button", { name: "上传文件" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("文件超过 25 MiB")
  })

  it("lets a SQLite import choose any inspected table", async () => {
    const sqliteInspection = {
      ...inspection,
      format: "sqlite",
      tables: ["words"],
      selected_table: "",
    }
    mocks.uploadImport
      .mockResolvedValueOnce({ job_id: "job-1", inspection: sqliteInspection })
      .mockResolvedValueOnce({ job_id: "job-2", inspection: { ...sqliteInspection, selected_table: "words" } })
    const { container } = render(<ImportWizard />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(["sqlite"], "words.sqlite")

    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole("button", { name: "上传文件" }))
    fireEvent.change(await screen.findByLabelText("数据表"), { target: { value: "words" } })

    await waitFor(() => expect(mocks.uploadImport).toHaveBeenLastCalledWith(file, "words"))
  })

  it("renders an invalid preview row when normalization is omitted", async () => {
    mocks.previewImport.mockResolvedValueOnce({
      job_id: "job-1",
      state: "previewed",
      mapping: { term: "word", definition: "meaning" },
      summary: { rows: 1, insert: 0, exact_duplicate: 0, review: 0, new_sense: 0, invalid: 1 },
      rows: [{
        row_id: "row-invalid",
        row_number: 1,
        raw: { word: "", meaning: "" },
        disposition: "invalid",
        error: "term is required",
      }],
    })
    const { container } = render(<ImportWizard />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["word,meaning"], "words.csv")] } })
    fireEvent.click(screen.getByRole("button", { name: "上传文件" }))
    fireEvent.change(await screen.findByLabelText("单词 源列"), { target: { value: "word" } })
    fireEvent.change(screen.getByLabelText("释义 源列"), { target: { value: "meaning" } })
    fireEvent.click(screen.getByRole("button", { name: "预览导入" }))

    expect(await screen.findByText("term is required")).toBeInTheDocument()
  })

  it("lets the learner retry after a failed preview", async () => {
    mocks.previewImport.mockRejectedValueOnce(new Error("映射无效"))
    const { container } = render(<ImportWizard />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["word,meaning"], "words.csv")] } })
    fireEvent.click(screen.getByRole("button", { name: "上传文件" }))
    fireEvent.change(await screen.findByLabelText("单词 源列"), { target: { value: "word" } })
    fireEvent.change(screen.getByLabelText("释义 源列"), { target: { value: "meaning" } })
    fireEvent.click(screen.getByRole("button", { name: "预览导入" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("映射无效")
    fireEvent.click(screen.getByRole("button", { name: "预览导入" }))

    expect(await screen.findByText("exact_duplicate")).toBeInTheDocument()
    expect(mocks.previewImport).toHaveBeenCalledTimes(2)
  })

  it("lets the learner retry after a failed commit", async () => {
    mocks.commitImport.mockRejectedValueOnce(new Error("提交失败"))
    const { container } = render(<ImportWizard />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["word,meaning\nabandon,放弃\n"], "words.csv")] } })
    fireEvent.click(screen.getByRole("button", { name: "上传文件" }))
    fireEvent.change(await screen.findByLabelText("单词 源列"), { target: { value: "word" } })
    fireEvent.change(screen.getByLabelText("释义 源列"), { target: { value: "meaning" } })
    fireEvent.click(screen.getByRole("button", { name: "预览导入" }))

    const resolution = await screen.findByLabelText("第 2 行处理方式")
    fireEvent.change(resolution, { target: { value: "merge" } })
    fireEvent.click(screen.getByRole("button", { name: "提交导入" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("提交失败")

    fireEvent.click(screen.getByRole("button", { name: "提交导入" }))
    expect(await screen.findByText(/已导入 1 条知识点/)).toBeInTheDocument()
    expect(mocks.commitImport).toHaveBeenCalledTimes(2)
  })

  it("keeps the previous inspection when a SQLite table re-upload fails", async () => {
    const sqliteInspection = {
      ...inspection,
      format: "sqlite" as const,
      tables: ["words"],
      selected_table: "",
    }
    mocks.uploadImport
      .mockResolvedValueOnce({ job_id: "job-1", inspection: sqliteInspection })
      .mockRejectedValueOnce(new Error("表读取失败"))
    const { container } = render(<ImportWizard />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["sqlite"], "words.sqlite")] } })
    fireEvent.click(screen.getByRole("button", { name: "上传文件" }))
    fireEvent.change(await screen.findByLabelText("数据表"), { target: { value: "words" } })

    expect(await screen.findByRole("alert")).toHaveTextContent("表读取失败")
    expect(screen.getByLabelText("数据表")).toHaveValue("")
    expect(screen.getByText(/job-1/)).toBeInTheDocument()
    expect(mocks.uploadImport).toHaveBeenCalledTimes(2)
  })
})
