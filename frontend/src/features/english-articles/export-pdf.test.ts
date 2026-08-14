import { render } from "@testing-library/react"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"

import { EnglishArticleBody } from "./EnglishArticleBody"

import {
  buildArticlePdfDefinition,
  exportArticlePdf,
  sanitizeFilename,
} from "./export-pdf"

const pdfMocks = vi.hoisted(() => ({
  addFonts: vi.fn(),
  addVirtualFileSystem: vi.fn(),
  download: vi.fn(),
}))

vi.mock("pdfmake/build/pdfmake", () => ({
  default: {
    addFonts: pdfMocks.addFonts,
    addVirtualFileSystem: pdfMocks.addVirtualFileSystem,
    createPdf: () => ({ download: pdfMocks.download }),
  },
}))
vi.mock("pdfmake/build/vfs_fonts", () => ({ default: {} }))
vi.mock("../../assets/fonts/LXGWWenKai-Regular.ttf", () => ({ default: "/LXGWWenKai-Regular.ttf" }))

function createArticle(markup: string): HTMLElement {
  const root = document.createElement("article")
  root.innerHTML = markup
  return root
}

describe("sanitizeFilename", () => {
  it("turns unsafe Windows filename characters into a bounded filename", () => {
    expect(sanitizeFilename('  An: article* with?bad\\chars/  ')).toBe(
      "An-article-with-bad-chars",
    )
    expect(sanitizeFilename("   ")).toBe("article")
  })

  it("avoids reserved Windows device names and trailing dots", () => {
    expect(sanitizeFilename("CON")).toBe("article-CON")
    expect(sanitizeFilename("reading notes... ")).toBe("reading-notes")
  })
})

describe("buildArticlePdfDefinition", () => {
  it("renders supported article blocks without mutating the source DOM", () => {
    const root = createArticle(`
      <h1>Improved reading</h1>
      <p>Hello <strong>bold</strong>, <em>italic</em>, <u>underlined</u>,
        <a href="/guide">guide</a>.</p>
      <blockquote><p>A useful quote.</p></blockquote>
      <ul><li>first</li></ul>
      <ol><li>second</li></ol>
      <hr>
      <div data-pdf-ignore>Do not export this control</div>
    `)

    const definition = buildArticlePdfDefinition(root, "Improved reading")
    const serialized = JSON.stringify(definition)

    expect(definition.pageSize).toBe("A4")
    expect(definition.defaultStyle).toMatchObject({ font: "LXGW" })
    expect(definition.header).toBeTypeOf("function")
    expect(definition.footer).toBeTypeOf("function")
    expect(serialized).toContain('"style":"h1"')
    expect(serialized).toContain('"bold":true')
    expect(serialized).toContain('"italics":true')
    expect(serialized).toContain('"decoration":"underline"')
    expect(serialized).toContain('"link":"/guide"')
    expect(serialized).toContain('"style":"blockquote"')
    expect(serialized).toContain('"ul"')
    expect(serialized).toContain('"ol"')
    expect(serialized).toContain('"canvas"')
    expect(serialized).not.toContain("Do not export this control")
    expect(root.textContent).toContain("Do not export this control")
  })

  it("preserves the real detail header hierarchy and source link", () => {
    const root = createArticle(`
      <header>
        <h1>Improved reading</h1>
        <p>Original reading</p>
        <div>
          <span>A. Writer</span>
          <a href="https://example.test/article">Daily Brief</a>
          <time>2026-08-15</time>
        </div>
      </header>
    `)

    const serialized = JSON.stringify(buildArticlePdfDefinition(root, "Improved reading"))

    expect(serialized).toContain('"text":"Improved reading","style":"h1"')
    expect(serialized).toContain('"style":"articleHeader"')
    expect(serialized).toContain('"style":"metadata"')
    expect(serialized).toContain('"text":["A. Writer",')
    expect(serialized).toContain('"link":"https://example.test/article"')
  })

  it("adds a trailing h2-only directory with page references", () => {
    const root = createArticle(`
      <h1>Improved reading</h1>
      <h2>Opening</h2>
      <h3>Not in directory</h3>
      <p>First section.</p>
      <h2>Closing</h2>
    `)

    const definition = buildArticlePdfDefinition(root, "Improved reading")
    const content = definition.content as unknown as Array<Record<string, unknown>>
    const serialized = JSON.stringify(definition)

    expect(content.at(-1)).toMatchObject({ pageBreak: "before" })
    expect(serialized).toContain('"style":"tocDirectory"')
    expect(serialized).toContain('"tocItem":"article-toc"')
    expect(serialized).toContain('"pageReference":"article-section-1"')
    expect(serialized).toContain('"pageReference":"article-section-2"')
    expect(serialized).not.toContain('"pageReference":"article-section-3"')
  })

  it("renders vocabulary data attributes as a readable entry", () => {
    const root = createArticle(`
      <section data-vocabulary-entry>
        <strong data-vocabulary-term>resilient</strong>
        <span data-vocabulary-pronunciation>/ri-ZIL-ee-uhnt/</span>
        <span data-vocabulary-definition>able to recover quickly</span>
        <p data-vocabulary-example>She stayed resilient.</p>
      </section>
    `)

    const definition = buildArticlePdfDefinition(root, "Vocabulary")
    const serialized = JSON.stringify(definition)

    expect(serialized).toContain('"style":"vocabulary"')
    expect(serialized).toContain("resilient")
    expect(serialized).toContain("/ri-ZIL-ee-uhnt/")
    expect(serialized).toContain("able to recover quickly")
    expect(serialized).toContain("She stayed resilient.")
  })

  it("preserves the real article body's inline emphasis, usage, and every example", () => {
    const { container } = render(
      createElement(EnglishArticleBody, {
        content: {
          title: "Real body",
          metadata: {},
          sections: [{
            title: "Opening",
            paragraphs: [{
              segments: [
                { text: "Read " },
                { text: "closely", emphasized: true },
                { text: " today." },
              ],
              translation: "今天仔细阅读。",
            }],
            vocabulary: [{
              term: "closely",
              british_phonetic: "/ˈkləʊsli/",
              american_phonetic: "/ˈkloʊsli/",
              definition: "仔细地",
              usage: "修饰阅读动作",
              examples: ["Read closely.", "Listen closely."],
            }],
          }],
        },
      }),
    )
    const root = container.firstElementChild as HTMLElement

    const definition = buildArticlePdfDefinition(root, "Real body")
    const serialized = JSON.stringify(definition)

    expect(serialized).toContain('"text":["Read ",{"text":"closely","decoration":"underline"')
    expect(serialized).toContain('"text":["Read ",{"text":"closely","decoration":"underline","decorationColor":"#1f2937","bold":true}')
    expect(serialized).toContain("修饰阅读动作")
    expect(serialized).toContain("Read closely.")
    expect(serialized).toContain("Listen closely.")
    expect(serialized).toContain("英 ")
    expect(serialized).toContain("美 ")
  })

  it("retries PDF initialization after a transient font load failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })
    vi.stubGlobal("fetch", fetchMock)
    const root = createArticle("<p>Retry this export.</p>")

    await expect(exportArticlePdf(root, "Retry article")).rejects.toThrow("Font load failed: 503")
    await expect(exportArticlePdf(root, "Retry article")).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(pdfMocks.download).toHaveBeenCalledWith("Retry-article.pdf")
  })
})
