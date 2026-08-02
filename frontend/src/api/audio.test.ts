import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { playPronunciation } from "./audio"

describe("pronunciation playback", () => {
  beforeEach(() => {
    window.__STUDY_OS_API_BASE__ = "http://127.0.0.1:43123"
  })

  afterEach(() => {
    delete window.__STUDY_OS_API_BASE__
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("plays the server audio asset before using browser speech", async () => {
    const play = vi.fn().mockResolvedValue(undefined)
    const audioConstructor = vi.fn(function AudioMock() { return { play } })
    Object.defineProperty(window, "Audio", { configurable: true, value: audioConstructor })
    const speak = vi.fn()
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel: vi.fn(), speak },
    })

    await expect(playPronunciation("abandon")).resolves.toBe("file")
    expect(audioConstructor).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/audio?term=abandon&locale=en-US&format=wav",
    )
    expect(play).toHaveBeenCalledOnce()
    expect(speak).not.toHaveBeenCalled()
  })

  it("uses visible browser speech fallback when file playback fails", async () => {
    const audioConstructor = vi.fn(function AudioMock() { return {
      play: vi.fn().mockRejectedValue(new Error("missing")),
    } })
    Object.defineProperty(window, "Audio", { configurable: true, value: audioConstructor })
    const cancel = vi.fn()
    const speak = vi.fn()
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel, speak },
    })
    class MockUtterance {
      lang = ""
      text: string
      constructor(text: string) {
        this.text = text
      }
    }
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance)

    await expect(playPronunciation("abandon")).resolves.toBe("browser")
    expect(cancel).toHaveBeenCalledOnce()
    expect(speak).toHaveBeenCalledOnce()
  })
})
