import type { Content, TDocumentDefinitions } from "pdfmake/interfaces"

const FONT_FILE_NAME = "LXGWWenKai-Regular.ttf"
const PDF_FONT_NAME = "LXGW"
const LINK_COLOR = "#2563eb"
const HEADING_COLOR = "#0f766e"
const MUTED_COLOR = "#64748b"
const TEXT_COLOR = "#1f2937"

type PdfMakeApi = {
  addFonts?: (fonts: Record<string, Record<string, string>>) => void
  addVirtualFileSystem?: (vfs: Record<string, string>) => void
  createPdf: (definition: TDocumentDefinitions) => {
    download: (fileName?: string) => void | Promise<void>
  }
  fonts?: Record<string, Record<string, string>>
}

type PdfMakeModule = PdfMakeApi & { default?: PdfMakeApi }

interface ArticleSectionReference {
  id: string
  title: string
}

interface PdfBuildContext {
  sections: ArticleSectionReference[]
}

let pdfMakeReady: Promise<PdfMakeApi> | null = null

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[. -]+$/g, "")
    .slice(0, 80)

  if (!cleaned) return "article"
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(cleaned)) {
    return `article-${cleaned}`
  }
  return cleaned
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function inlineContent(node: Node): Content {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.replace(/\s+/g, " ") || ""
  }

  if (!(node instanceof Element)) {
    return cleanText(node.textContent || "")
  }

  const tag = node.tagName.toLowerCase()
  if (tag === "br") return "\n"

  const children = Array.from(node.childNodes)
    .map(inlineContent)
    .filter((child) => child !== "")
  const text: Content = children.length === 1 ? children[0] : children
  const style: Record<string, unknown> = {}

  if (tag === "strong" || tag === "b") style.bold = true
  if (tag === "em" || tag === "i") style.italics = true
  if (tag === "u") {
    style.decoration = "underline"
    style.decorationColor = TEXT_COLOR
  }
  if (tag === "a") {
    const href = node.getAttribute("href")
    if (href) {
      style.link = href
      style.color = LINK_COLOR
      style.decoration = "underline"
      style.decorationColor = LINK_COLOR
    }
  }

  if (!Object.keys(style).length) return text
  if (typeof text === "object" && text !== null && "text" in text) {
    return { ...text, ...style } as Content
  }

  return { text, ...style } as Content
}

function directInlineContent(element: Element): Content {
  const children = Array.from(element.childNodes)
    .map(inlineContent)
    .filter((child) => child !== "")
  return children.length === 1 ? children[0] : children
}

function listItemContent(item: Element): Content {
  const nestedLists = Array.from(item.children).filter((child) =>
    ["ul", "ol"].includes(child.tagName.toLowerCase()),
  )
  const directChildren = Array.from(item.childNodes).filter(
    (child) => !(child instanceof Element && nestedLists.includes(child)),
  )
  const text = directChildren
    .map(inlineContent)
    .filter((child) => child !== "")
  const itemContent: Record<string, unknown> = {
    text: text.length === 1 ? text[0] : text,
  }

  for (const nested of nestedLists) {
    const key = nested.tagName.toLowerCase() === "ol" ? "ol" : "ul"
    itemContent[key] = listItems(nested)
  }

  return itemContent as unknown as Content
}

function listItems(list: Element): Content[] {
  return Array.from(list.children)
    .filter((child) => child.tagName.toLowerCase() === "li")
    .map((item) =>
      item.matches("[data-vocabulary-entry]")
        ? vocabularyToContent(item)
        : listItemContent(item),
    )
}

function firstDataText(element: Element, ...names: string[]): string {
  for (const name of names) {
    const candidate = element.querySelector<HTMLElement>(`[${name}]`)
    const value = cleanText(candidate?.textContent || "")
    if (value) return value
  }
  return ""
}

function allDataTexts(element: Element, ...names: string[]): string[] {
  const selector = names.map((name) => `[${name}]`).join(",")
  const values = Array.from(element.querySelectorAll<HTMLElement>(selector))
    .map((candidate) => cleanText(candidate.textContent || ""))
    .filter(Boolean)
  return [...new Set(values)]
}

function vocabularyToContent(element: Element): Content {
  const term = firstDataText(
    element,
    "data-vocabulary-term",
    "data-vocabulary-word",
  )
  const pronunciations = allDataTexts(
    element,
    "data-vocabulary-pronunciation",
    "data-vocabulary-phonetic",
  )
  const definition = firstDataText(
    element,
    "data-vocabulary-definition",
    "data-vocabulary-meaning",
  )
  const usage = firstDataText(
    element,
    "data-vocabulary-usage",
  )
  const examples = allDataTexts(
    element,
    "data-vocabulary-example",
    "data-vocabulary-sentence",
  )

  const stack: Content[] = []
  const fallback = cleanText(element.textContent || "")
  if (term) stack.push({ text: term, bold: true, color: HEADING_COLOR })
  if (pronunciations.length > 0 || definition) {
    stack.push({
      columns: [
        pronunciations.length > 0 ? {
          stack: pronunciations.map((pronunciation) => ({ text: pronunciation, color: MUTED_COLOR })),
          width: "auto",
        } : "",
        definition ? { text: definition, width: "*", margin: [10, 0, 0, 0] } : "",
      ].filter(Boolean),
      columnGap: 6,
    } as Content)
  }
  if (usage) stack.push({ text: usage, color: MUTED_COLOR })
  for (const example of examples) {
    stack.push({ text: example, italics: true, color: MUTED_COLOR })
  }
  if (!stack.length && fallback) stack.push({ text: fallback })

  return { stack, style: "vocabulary" } as Content
}

function blockquoteToContent(element: Element, context: PdfBuildContext): Content {
  const blockTags = new Set(["article", "blockquote", "div", "h1", "h2", "h3", "ol", "p", "section", "ul"])
  const hasBlockChildren = Array.from(element.children).some((child) =>
    blockTags.has(child.tagName.toLowerCase()),
  )
  const blocks = hasBlockChildren
    ? Array.from(element.children).flatMap((child) => elementToBlocks(child, context))
    : [{ text: directInlineContent(element) } as Content]
  const fallback = cleanText(element.textContent || "")
  const stack = blocks.length ? blocks : fallback ? [{ text: fallback }] : []
  return {
    table: {
      widths: [2, "*"],
      body: [
        [
          { text: "", fillColor: HEADING_COLOR },
          { stack, margin: [10, 4, 4, 4] },
        ],
      ],
    },
    layout: "noBorders",
    style: "blockquote",
  } as Content
}

function metadataToContent(element: Element): Content {
  const values = Array.from(element.children)
    .map(inlineContent)
    .filter((value) => value !== "")
  const text = values.length > 0
    ? values.flatMap((value, index) => index === 0 ? [value] : [" · ", value])
    : directInlineContent(element)
  return { text, style: "metadata" } as Content
}

function articleHeaderToContent(element: Element, context: PdfBuildContext): Content {
  const stack = Array.from(element.children).flatMap((child) => {
    const tag = child.tagName.toLowerCase()
    if (tag === "h1") return [{ text: directInlineContent(child), style: "h1" } as Content]
    if (tag === "p") return [{ text: directInlineContent(child), style: "articleSubtitle" } as Content]
    if (tag === "div") return [metadataToContent(child)]
    return elementToBlocks(child, context)
  })
  return { stack, style: "articleHeader" } as Content
}

function elementToBlocks(element: Element, context: PdfBuildContext): Content[] {
  const tag = element.tagName.toLowerCase()

  if (element.matches("[data-vocabulary-entry]")) {
    return [vocabularyToContent(element)]
  }

  switch (tag) {
    case "h1":
    case "h3":
      return [{ text: directInlineContent(element), style: tag }]
    case "h2": {
      const title = cleanText(element.textContent || "")
      const id = `article-section-${context.sections.length + 1}`
      context.sections.push({ id, title })
      return [{
        text: directInlineContent(element),
        style: tag,
        id,
        tocItem: "article-toc",
      } as Content]
    }
    case "p":
      return [{ text: directInlineContent(element), style: "paragraph" }]
    case "blockquote":
      return [blockquoteToContent(element, context)]
    case "ul":
      return [{ ul: listItems(element), style: "list" }]
    case "ol":
      return [{ ol: listItems(element), style: "list" }]
    case "hr":
      return [
        {
          canvas: [
            {
              type: "line",
              x1: 0,
              y1: 0,
              x2: 499,
              y2: 0,
              lineWidth: 0.7,
              lineColor: HEADING_COLOR,
            },
          ],
          margin: [0, 8, 0, 8],
        },
      ]
    case "div":
    case "section":
    case "article":
      return Array.from(element.children).flatMap((child) => elementToBlocks(child, context))
    case "header":
      return [articleHeaderToContent(element, context)]
    case "br":
      return []
    default: {
      const content = inlineContent(element)
      return content === "" || (Array.isArray(content) && content.length === 0)
        ? []
        : [{ text: content, style: "paragraph" }]
    }
  }
}

function tableOfContentsToContent(sections: ArticleSectionReference[]): Content | null {
  if (sections.length === 0) return null
  return {
    stack: [
      { text: "章节目录", style: "tocTitle" },
      ...sections.map(({ id, title }) => ({
        columns: [
          { text: title, linkToDestination: id, width: "*" },
          { pageReference: id, alignment: "right", width: "auto", color: MUTED_COLOR },
        ],
        columnGap: 12,
        style: "tocEntry",
      } as Content)),
    ],
    pageBreak: "before",
    style: "tocDirectory",
  } as Content
}

function cloneArticleRoot(root: HTMLElement): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement
  if (clone.matches("[data-pdf-ignore]")) {
    clone.replaceChildren()
    return clone
  }
  clone.querySelectorAll("[data-pdf-ignore]").forEach((node) => node.remove())
  return clone
}

export function buildArticlePdfDefinition(
  root: HTMLElement,
  title: string,
): TDocumentDefinitions {
  const clone = cloneArticleRoot(root)
  const context: PdfBuildContext = { sections: [] }
  const content = Array.from(clone.children).flatMap((child) => elementToBlocks(child, context))
  const tableOfContents = tableOfContentsToContent(context.sections)
  if (tableOfContents) content.push(tableOfContents)
  const safeTitle = cleanText(title) || "English article"

  return {
    pageSize: "A4",
    pageMargins: [48, 56, 48, 50],
    info: { title: safeTitle },
    defaultStyle: {
      font: PDF_FONT_NAME,
      fontSize: 10.8,
      lineHeight: 1.55,
      color: TEXT_COLOR,
    },
    content,
    styles: {
      h1: { fontSize: 22, bold: true, color: HEADING_COLOR, margin: [0, 0, 0, 12] },
      h2: { fontSize: 16, bold: true, color: HEADING_COLOR, margin: [0, 18, 0, 8] },
      h3: { fontSize: 13, bold: true, color: HEADING_COLOR, margin: [0, 14, 0, 6] },
      articleHeader: { margin: [0, 0, 0, 18] },
      articleSubtitle: { fontSize: 13, color: MUTED_COLOR, margin: [0, 0, 0, 8] },
      metadata: { fontSize: 9.5, color: MUTED_COLOR, margin: [0, 0, 0, 4] },
      paragraph: { fontSize: 10.8, lineHeight: 1.55, margin: [0, 4, 0, 5] },
      list: { fontSize: 10.8, lineHeight: 1.5, margin: [0, 4, 0, 8] },
      blockquote: { fontSize: 10.6, color: "#475569", margin: [0, 6, 0, 10] },
      vocabulary: {
        fontSize: 10.2,
        lineHeight: 1.45,
        background: "#f0fdfa",
        margin: [0, 5, 0, 8],
      },
      tocDirectory: { margin: [0, 0, 0, 0] },
      tocTitle: { fontSize: 18, bold: true, color: HEADING_COLOR, margin: [0, 0, 0, 14] },
      tocEntry: { fontSize: 10.8, margin: [0, 4, 0, 4] },
    },
    header: () => ({
      columns: [
        { text: "English article", color: MUTED_COLOR, fontSize: 8 },
        { text: safeTitle, color: HEADING_COLOR, fontSize: 8, alignment: "right" },
      ],
      margin: [48, 22, 48, 0],
    }),
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: "right",
      color: MUTED_COLOR,
      fontSize: 8.5,
      margin: [0, 0, 48, 18],
    }),
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

async function loadPdfMake(): Promise<PdfMakeApi> {
  const pdfMakeModule = (await import("pdfmake/build/pdfmake")) as unknown as PdfMakeModule
  const pdfMake = pdfMakeModule.default || pdfMakeModule
  const vfsModule = (await import("pdfmake/build/vfs_fonts")) as unknown as {
    default: Record<string, string>
  }
  const vfs = vfsModule.default
  pdfMake.addVirtualFileSystem?.(vfs)

  const fontModule = (await import("../../assets/fonts/LXGWWenKai-Regular.ttf")) as unknown as {
    default: string
  }
  const response = await fetch(fontModule.default)
  if (!response.ok) throw new Error(`Font load failed: ${response.status}`)
  pdfMake.addVirtualFileSystem?.({
    [FONT_FILE_NAME]: arrayBufferToBase64(await response.arrayBuffer()),
  })

  const fonts = {
    [PDF_FONT_NAME]: {
      normal: FONT_FILE_NAME,
      bold: FONT_FILE_NAME,
      italics: FONT_FILE_NAME,
      bolditalics: FONT_FILE_NAME,
    },
  }
  if (pdfMake.addFonts) pdfMake.addFonts(fonts)
  else pdfMake.fonts = { ...(pdfMake.fonts || {}), ...fonts }
  return pdfMake
}

export async function exportArticlePdf(
  root: HTMLElement,
  title: string,
): Promise<void> {
  if (!pdfMakeReady) {
    pdfMakeReady = loadPdfMake().catch((error: unknown) => {
      pdfMakeReady = null
      throw error
    })
  }
  const pdfMake = await pdfMakeReady
  const definition = buildArticlePdfDefinition(root, title)
  await pdfMake.createPdf(definition).download(`${sanitizeFilename(title)}.pdf`)
}
