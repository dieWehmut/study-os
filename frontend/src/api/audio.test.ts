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

  it("asks the server to synthesize before giving up on browser speech", async () => {
    // The cloud TTS feature is only reachable through POST /api/audio; a plain
    // GET never generates anything. Without this step the DashScope voice and
    // its timeline are dead code and every 朗读 press lands on the browser's
    // robotic fallback.
    const play = vi.fn()
      .mockRejectedValueOnce(new Error("cache miss"))
      .mockResolvedValueOnce(undefined)
    const audioConstructor = vi.fn(function AudioMock() { return { play } })
    Object.defineProperty(window, "Audio", { configurable: true, value: audioConstructor })
    const speak = vi.fn()
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel: vi.fn(), speak },
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["audio-bytes"], { type: "audio/wav" }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const createObjectURL = vi.fn().mockReturnValue("blob:generated")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL })

    await expect(playPronunciation("abandon")).resolves.toBe("file")

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://127.0.0.1:43123/api/audio?term=abandon&locale=en-US&format=wav")
    expect(init.method).toBe("POST")
    // The route rejects generation requests without this header, so a missing
    // one is a silent 403 rather than a synthesized word.
    expect(init.headers["X-Study-OS-Request"]).toBe("1")
    expect(audioConstructor).toHaveBeenLastCalledWith("blob:generated")
    expect(speak).not.toHaveBeenCalled()
  })

  it("uses visible browser speech fallback when synthesis is unavailable too", async () => {
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
    // 503: the server has no generator it can reach.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }))

    await expect(playPronunciation("abandon")).resolves.toBe("browser")
    expect(cancel).toHaveBeenCalledOnce()
    expect(speak).toHaveBeenCalledOnce()
  })
})
