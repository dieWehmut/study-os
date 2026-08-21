import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import EnglishArticles from "./EnglishArticles"

vi.mock("@/features/english-articles/EnglishArticleLibrary", () => ({
  default: () => <div data-testid="english-article-library">library</div>,
}))

describe("EnglishArticles page", () => {
  it("frames the article library with a clear heading", () => {
    render(
      <MemoryRouter>
        <EnglishArticles />
      </MemoryRouter>,
    )

    expect(screen.getByRole("heading", { name: /英语时文/ })).toBeInTheDocument()
    expect(screen.getByTestId("english-article-library")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "英语语料" })).toHaveAttribute("href", "/reading/english-corpora")
  })
})
