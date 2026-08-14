import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { EnglishArticleContent } from "@/api/english-articles"
import EnglishArticleBody from "./EnglishArticleBody"

const content: EnglishArticleContent = {
  title: "Market Shifts",
  metadata: { author: "A. Writer", source_name: "Daily Brief" },
  sections: [
    {
      title: "Opening",
      paragraphs: [
        {
          segments: [
            { text: "The market " },
            { text: "shifted quickly", emphasized: true },
            { text: "." },
          ],
          translation: "市场迅速变化。",
        },
      ],
      vocabulary: [
        {
          term: "shifted",
          british_phonetic: "[ʃɪft]",
          american_phonetic: "[ʃɪft]",
          part_of_speech: "v.",
          definition: "发生变化",
          usage: "shift the focus",
          examples: ["The plan shifted."],
        },
      ],
    },
  ],
}

describe("EnglishArticleBody", () => {
  it("renders bilingual paragraphs and marks emphasized segments", () => {
    render(<EnglishArticleBody content={content} />)

    expect(screen.getByRole("heading", { name: /Opening/ })).toBeInTheDocument()
    expect(screen.getByText("市场迅速变化。")).toBeInTheDocument()
    const emphasized = screen.getByText("shifted quickly")
    expect(emphasized.tagName).toBe("U")
    expect(emphasized.closest("strong")).not.toBeNull()
  })

  it("renders vocabulary with PDF data attributes and pronunciation controls", () => {
    const onSpeak = vi.fn()
    render(<EnglishArticleBody content={content} onSpeak={onSpeak} />)

    const entry = screen.getByTestId("vocabulary-entry-shifted")
    expect(entry).toHaveAttribute("data-vocabulary-entry")
    expect(entry.querySelector("[data-vocabulary-term]")).toHaveTextContent("shifted")
    const pronunciationLines = entry.querySelectorAll("[data-vocabulary-pronunciation]")
    expect(pronunciationLines).toHaveLength(2)
    expect(pronunciationLines[0]).toHaveTextContent(/^英 /)
    expect(pronunciationLines[0]).toHaveTextContent("[ʃɪft]")
    expect(pronunciationLines[1]).toHaveTextContent(/^美 /)
    expect(pronunciationLines[1]).toHaveTextContent("[ʃɪft]")
    fireEvent.click(screen.getByRole("button", { name: /朗读 shifted/ }))
    expect(onSpeak).toHaveBeenCalledWith("shifted")
  })
})
