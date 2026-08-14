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
    expect(screen.getByText("shifted quickly").tagName).toBe("U")
  })

  it("renders vocabulary with PDF data attributes and pronunciation controls", () => {
    const onSpeak = vi.fn()
    render(<EnglishArticleBody content={content} onSpeak={onSpeak} />)

    const entry = screen.getByTestId("vocabulary-entry-shifted")
    expect(entry).toHaveAttribute("data-vocabulary-entry")
    expect(entry.querySelector("[data-vocabulary-term]")).toHaveTextContent("shifted")
    expect(entry.querySelector("[data-vocabulary-pronunciation]")).toHaveTextContent("[ʃɪft]")
    fireEvent.click(screen.getByRole("button", { name: /朗读 shifted/ }))
    expect(onSpeak).toHaveBeenCalledWith("shifted")
  })
})
