import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import EnglishArticleNew from "./EnglishArticleNew"

vi.mock("@/features/english-articles/EnglishArticleComposer", () => ({
  default: () => <div data-testid="english-article-composer">composer</div>,
}))

describe("EnglishArticleNew page", () => {
  it("frames the composer with a clear heading", () => {
    render(
      <MemoryRouter>
        <EnglishArticleNew />
      </MemoryRouter>,
    )

    expect(screen.getByRole("heading", { name: /添加英语时文/ })).toBeInTheDocument()
    expect(screen.getByTestId("english-article-composer")).toBeInTheDocument()
  })
})
