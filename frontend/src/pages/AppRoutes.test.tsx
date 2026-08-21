import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import App from "@/App"

vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock("@/features/update/UpdateDialog", () => ({ UpdateDialog: () => null }))
vi.mock("@/pages/Home", () => ({ default: () => <div>home</div> }))
vi.mock("@/pages/Import", () => ({ default: () => <div>import</div> }))
vi.mock("@/pages/Knowledge", () => ({ default: () => <div>knowledge</div> }))
vi.mock("@/pages/Memory", () => ({ default: () => <div>memory</div> }))
vi.mock("@/pages/Chat", () => ({ default: () => <div>chat</div> }))
vi.mock("@/pages/Integrate", () => ({ default: () => <div>integrate</div> }))
vi.mock("@/pages/Practice", () => ({ default: () => <div>practice</div> }))
vi.mock("@/pages/Settings", () => ({ default: () => <div>settings</div> }))
vi.mock("@/pages/Reading", () => ({ default: () => <div>reading</div> }))
vi.mock("@/pages/EnglishArticles", () => ({ default: () => <div>english-library</div> }))
vi.mock("@/pages/EnglishArticleNew", () => ({ default: () => <div>english-new</div> }))
vi.mock("@/pages/EnglishArticleDetail", () => ({ default: () => <div>english-detail</div> }))
vi.mock("@/pages/EnglishCorpora", () => ({ default: () => <div>english-corpora</div> }))
vi.mock("@/pages/Lessons", () => ({ default: () => <div>lessons</div> }))
vi.mock("@/pages/LessonDetail", () => ({ default: () => <div>lesson-detail</div> }))

describe("English article routes", () => {
  it.each([
    ["/reading/articles", "english-library"],
    ["/reading/articles/new", "english-new"],
    ["/reading/articles/article-1", "english-detail"],
    ["/reading/english-corpora", "english-corpora"],
  ])("registers %s", (path, text) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText(text)).toBeInTheDocument()
  })
})

describe("lesson routes", () => {
  it.each([
    ["/lessons", "lessons"],
    ["/lessons/lesson-1", "lesson-detail"],
  ])("registers %s", (path, text) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText(text)).toBeInTheDocument()
  })
})
