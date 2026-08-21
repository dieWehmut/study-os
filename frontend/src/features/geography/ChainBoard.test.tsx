import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ChainBoard } from "./ChainBoard"

function link(cause: string, effect: string) {
  fireEvent.change(screen.getByLabelText("成因"), { target: { value: cause } })
  fireEvent.change(screen.getByLabelText("结果"), { target: { value: effect } })
  fireEvent.click(screen.getByRole("button", { name: "加上这一环" }))
}

describe("writing out a 因果链 one link at a time", () => {
  it("restores links and reports additions and removals", () => {
    const onChange = vi.fn()
    render(
      <ChainBoard
        initialValue={{ links: [{ cause: "太阳辐射强", effect: "地表增温" }] }}
        onChange={onChange}
      />,
    )

    expect(screen.getByText("太阳辐射强")).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()

    link("地表增温", "空气受热上升")
    expect(onChange).toHaveBeenLastCalledWith({
      links: [
        { cause: "太阳辐射强", effect: "地表增温" },
        { cause: "地表增温", effect: "空气受热上升" },
      ],
    })

    fireEvent.click(screen.getByRole("button", { name: "删掉第 1 环" }))
    expect(onChange).toHaveBeenLastCalledWith({
      links: [{ cause: "地表增温", effect: "空气受热上升" }],
    })
  })

  it("says so when the chain runs from end to end", () => {
    render(<ChainBoard />)

    link("太阳辐射强", "地表增温")
    link("地表增温", "空气受热上升")

    expect(screen.getByText("因果链连起来了")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("names the two ends the missing link goes between", () => {
    render(<ChainBoard />)

    link("太阳辐射强", "地表增温")
    link("沿岸有寒流", "降水稀少")

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("地表增温")
    expect(alert).toHaveTextContent("沿岸有寒流")
  })

  it("shows every gap, so the second one is not hidden by the first", () => {
    render(<ChainBoard />)

    link("太阳辐射强", "地表增温")
    link("沿岸有寒流", "水汽难以凝结")
    link("水汽难以凝结", "降水稀少")
    link("地形闭塞", "植被稀疏")

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("沿岸有寒流")
    expect(alert).toHaveTextContent("地形闭塞")
  })

  it("takes a longer restatement of the last result as the same link", () => {
    // The board has to hold the chain to the same rule the check does: an
    // answer usually carries the last result forward with more words attached,
    // and calling that a gap would be wrong on every real one.
    render(<ChainBoard />)

    link("太阳辐射强", "地表增温")
    link("地表增温、空气膨胀", "空气上升")

    expect(screen.getByText("因果链连起来了")).toBeInTheDocument()
  })

  it("drops a link you wrote by mistake", () => {
    render(<ChainBoard />)

    link("太阳辐射强", "地表增温")
    link("沿岸有寒流", "降水稀少")
    fireEvent.click(screen.getByRole("button", { name: "删掉第 2 环" }))

    expect(screen.queryByText("沿岸有寒流")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("will not take half a link", () => {
    // A 环 with only a 成因 is a line you have not finished, and letting it into
    // the chain would report it as a gap in the reasoning instead.
    render(<ChainBoard />)

    fireEvent.change(screen.getByLabelText("成因"), { target: { value: "太阳辐射强" } })

    expect(screen.getByRole("button", { name: "加上这一环" })).toBeDisabled()
  })

  it("waits for a second link before saying the chain holds", () => {
    // One link is not a chain, and 连起来了 said of it is a tick for nothing.
    render(<ChainBoard />)

    link("太阳辐射强", "地表增温")

    expect(screen.queryByText("因果链连起来了")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("says nothing at all about an empty board", () => {
    render(<ChainBoard />)

    expect(screen.queryByText("因果链连起来了")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
