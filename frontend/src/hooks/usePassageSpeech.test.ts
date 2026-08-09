import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { usePassageSpeech } from "./usePassageSpeech"

/** Two pieces of exactly the length the splitter is willing to keep apart. */
const first = `${"甲".repeat(70)}。`
const second = `${"乙".repeat(70)}。`
const passage = `${first}${second}`

class AudioStub {
  static instances: AudioStub[] = []
  src: string
  play = vi.fn().mockResolvedValue(undefined)
  pause = vi.fn()
  onended: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(src: string) {
    this.src = src
    AudioStub.instances.push(this)
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function term(call: unknown[]): string | null {
  return new URL(String(call[0])).searchParams.get("term")
}

function signalOf(call: unknown[]): AbortSignal {
  return (call[1] as { signal: AbortSignal }).signal
}

let fetchMock: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let created = 0

beforeEach(() => {
  window.__STUDY_OS_API_BASE__ = "http://127.0.0.1:43123"
  AudioStub.instances = []
  created = 0
  Object.defineProperty(window, "Audio", { configurable: true, value: AudioStub })
  fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["bytes"]) })
  vi.stubGlobal("fetch", fetchMock)
  revokeObjectURL = vi.fn()
  // jsdom ships neither half of the object-URL pair, so both are supplied here.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:piece-${(created += 1)}`),
  })
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL })
})

afterEach(() => {
  delete window.__STUDY_OS_API_BASE__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("reading a passage aloud", () => {
  it("plays the pieces in the order they were written", async () => {
    const { result } = renderHook(() => usePassageSpeech())

    act(() => result.current.start(passage))

    await waitFor(() => expect(result.current.status).toBe("playing"))
    expect(AudioStub.instances).toHaveLength(1)
    expect(term(fetchMock.mock.calls[0])).toBe(first)
    expect(result.current.currentIndex).toBe(0)
    expect(result.current.total).toBe(2)

    act(() => AudioStub.instances[0].onended?.())

    await waitFor(() => expect(AudioStub.instances).toHaveLength(2))
    expect(result.current.currentIndex).toBe(1)
    expect(AudioStub.instances[1].play).toHaveBeenCalledOnce()
  })

  it("asks for the next piece while the current one is playing", async () => {
    // 这就是整件事的目的：等待只应该是第一句的长度，而不是整段的合成时间。
    const third = `${"丙".repeat(70)}。`
    const { result } = renderHook(() => usePassageSpeech())

    act(() => result.current.start(`${passage}${third}`))

    await waitFor(() => expect(result.current.status).toBe("playing"))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(term(fetchMock.mock.calls[1])).toBe(second)
    // Depth two and no deeper: the engine serialises requests, so queueing the
    // third buys nothing and burns synthesis on text that may be skipped.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("reuses the piece it already fetched instead of asking twice", async () => {
    const { result } = renderHook(() => usePassageSpeech())

    act(() => result.current.start(passage))
    await waitFor(() => expect(result.current.status).toBe("playing"))
    act(() => AudioStub.instances[0].onended?.())
    await waitFor(() => expect(AudioStub.instances).toHaveLength(2))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("aborts what is in flight and revokes what is held when stopped", async () => {
    const { result } = renderHook(() => usePassageSpeech())

    act(() => result.current.start(passage))
    await waitFor(() => expect(result.current.status).toBe("playing"))
    const playing = AudioStub.instances[0]

    act(() => result.current.stop())

    expect(playing.pause).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith(playing.src)
    // The look-ahead is minutes of synthesis for a passage nobody is hearing.
    expect(signalOf(fetchMock.mock.calls[1]).aborted).toBe(true)
    expect(result.current.status).toBe("idle")
    expect(result.current.total).toBe(0)
  })

  it("does not start playing a piece that arrives after the stop", async () => {
    const pending = deferred<{ ok: boolean; blob: () => Promise<Blob> }>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => usePassageSpeech())

    act(() => result.current.start(passage))
    await waitFor(() => expect(result.current.status).toBe("preparing"))
    act(() => result.current.stop())

    await act(async () => {
      pending.resolve({ ok: true, blob: async () => new Blob(["late"]) })
      await pending.promise
    })

    expect(AudioStub.instances).toHaveLength(0)
    expect(result.current.status).toBe("idle")
  })

  it("says which piece failed instead of pretending it read the passage", async () => {
    // Skipping on would claim the whole section was read aloud when a third of
    // it never was.
    fetchMock.mockRejectedValue(new Error("语音服务没有响应"))
    const { result } = renderHook(() => usePassageSpeech())

    act(() => result.current.start(passage))

    await waitFor(() => expect(result.current.status).toBe("error"))
    expect(result.current.error).toBe("语音服务没有响应")
    expect(AudioStub.instances).toHaveLength(0)
  })

  it("stops the previous passage before starting another", async () => {
    const { result } = renderHook(() => usePassageSpeech())

    act(() => result.current.start(passage))
    await waitFor(() => expect(result.current.status).toBe("playing"))
    const previous = AudioStub.instances[0]

    act(() => result.current.start(`${"丁".repeat(70)}。`))
    await waitFor(() => expect(result.current.total).toBe(1))

    expect(previous.pause).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith(previous.src)
  })

  it("toggles off what it toggled on", async () => {
    const { result } = renderHook(() => usePassageSpeech())

    act(() => result.current.toggle(passage))
    await waitFor(() => expect(result.current.status).toBe("playing"))

    act(() => result.current.toggle(passage))

    expect(result.current.status).toBe("idle")
    expect(AudioStub.instances[0].pause).toHaveBeenCalledOnce()
  })

  // An independent review found this one: toggle() used to read `status` from
  // its own closure, which is only as current as the last render. Two calls
  // back to back, before React gets a chance to re-render between them, both
  // saw the same stale "idle" and both started a run -- so a fast double
  // click read as "start, then start over" instead of "start, then stop".
  it("treats a second toggle in the same tick as stop, not another start", () => {
    const { result } = renderHook(() => usePassageSpeech())

    act(() => {
      const { toggle } = result.current
      toggle(passage)
      toggle(passage)
    })

    expect(result.current.status).toBe("idle")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(signalOf(fetchMock.mock.calls[0]).aborted).toBe(true)
  })

  it("goes quiet when it is unmounted", async () => {
    const { result, unmount } = renderHook(() => usePassageSpeech())

    act(() => result.current.start(passage))
    await waitFor(() => expect(result.current.status).toBe("playing"))
    const playing = AudioStub.instances[0]

    unmount()

    expect(playing.pause).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith(playing.src)
    expect(signalOf(fetchMock.mock.calls[0]).aborted).toBe(true)
  })

  it("returns to idle after the last piece, rather than waiting on nothing", async () => {
    const { result } = renderHook(() => usePassageSpeech())

    act(() => result.current.start(passage))
    await waitFor(() => expect(result.current.status).toBe("playing"))
    act(() => AudioStub.instances[0].onended?.())
    await waitFor(() => expect(AudioStub.instances).toHaveLength(2))
    act(() => AudioStub.instances[1].onended?.())

    await waitFor(() => expect(result.current.status).toBe("idle"))
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it("says nothing at all for a passage with no words in it", () => {
    const { result } = renderHook(() => usePassageSpeech())

    act(() => result.current.start("   \n  "))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.status).toBe("idle")
  })
})
