import { describe, expect, it } from "vitest"

import {
  ENGLISH_CORPORA,
  englishCorpusAssetURL,
  parseEnglishCorpus,
} from "./english-corpora"

describe("built-in English corpora", () => {
  it("parses Word Wiki entries while excluding its navigation link", () => {
    const entries = parseEnglishCorpus(
      "- [[thesaurus-group/00-总目录|按语义词群浏览]]\n[[word-wiki/abandon|abandon]] · [[word-wiki/ability|ability]]",
      ENGLISH_CORPORA[0],
    )

    expect(entries.map((entry) => entry.label)).toEqual(["abandon", "ability"])
  })

  it("keeps multiword expressions and grammar families but drops helper indexes", () => {
    const entries = parseEnglishCorpus(
      "- [[01-全量总表]]\n- [[要求-建议-命令类动词|省略式虚拟语气]]\n- [[according to]] `fixed-expression`",
      ENGLISH_CORPORA[1],
    )

    expect(entries).toEqual([
      expect.objectContaining({ label: "省略式虚拟语气", target: "要求-建议-命令类动词" }),
      expect.objectContaining({ label: "according to", kind: "fixed-expression" }),
    ])
  })

  it("uses the Vite public base path for Pages and the desktop bundle", () => {
    expect(englishCorpusAssetURL(ENGLISH_CORPORA[0], { BASE_URL: "/study-os/" })).toBe(
      "/study-os/content/english/word-wiki-moc.md",
    )
    expect(englishCorpusAssetURL(ENGLISH_CORPORA[1], { BASE_URL: "/" })).toBe(
      "/content/english/multiword-expression-moc.md",
    )
  })
})
