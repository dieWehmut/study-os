import { describe, expect, it } from "vitest"

import { ApiError } from "@/api/client"
import { failureMessage } from "./errors"

describe("failureMessage", () => {
  it("suspects a backend that never answered", () => {
    // fetch throws when nothing is listening: that really is the likely cause.
    expect(failureMessage(new TypeError("Failed to fetch"), "无法读取课程")).toBe(
      "无法读取课程，请确认本地后端正在运行。",
    )
  })

  it("does not tell the reader to check a backend that just answered", () => {
    // The server answered 400 with its own words; asking whether it is running
    // would be false, and it is the one party that knows what happened.
    expect(failureMessage(new ApiError(400, "附件不能超过 5MB"), "无法读取课程")).toBe(
      "无法读取课程：附件不能超过 5MB",
    )
  })

  it("names our own failures as ours instead of leaking English internals", () => {
    expect(failureMessage(new ApiError(500, "list lessons failed"), "无法读取课程")).toBe(
      "无法读取课程：服务出错（500）",
    )
  })

  it("still says something for a status with no message", () => {
    // A 4xx with an empty body has nothing to pass on, but the status is still
    // worth saying rather than leaving the reader with a bare action.
    expect(failureMessage(new ApiError(400, ""), "无法读取课程")).toBe("无法读取课程（400）")
  })
})