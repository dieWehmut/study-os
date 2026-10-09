import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ErrorBoundary from "./ErrorBoundary"

function Exploding(): never {
  throw new Error("Cannot read properties of null (reading 'length')")
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React prints the caught error itself; the assertion below is about the
    // trace the boundary keeps, not about React's own logging.
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the page it is given", () => {
    render(
      <ErrorBoundary>
        <p>记忆检测</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText("记忆检测")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps one crashed page from taking the shell down with it", () => {
    // The failure that motivated this: a null reference-answer list unmounted
    // the whole tree, sidebar included, leaving nothing to press.
    render(
      <ErrorBoundary>
        <Exploding />
      </ErrorBoundary>,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("这个页面没能显示出来")
    expect(screen.getByRole("alert")).toHaveTextContent(/Cannot read properties of null/)
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument()
  })

  it("leaves the failure in the console instead of swallowing it", () => {
    render(
      <ErrorBoundary>
        <Exploding />
      </ErrorBoundary>,
    )

    expect(console.error).toHaveBeenCalled()
  })
})