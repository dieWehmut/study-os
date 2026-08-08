import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createSpeechReader, speechSupported } from "./speech"

interface FakeUtterance {
  text: string
  lang: string
  rate: number
  onend: (() => void) | null
  onerror: (() => void) | null
}

/**
 * A stand-in for the browser's speech singleton.
 *
 * Modelled on the real one's two awkward properties: speak() does not finish
 * on its own, and cancel() drops everything queued without calling onend. Both
 * are what the reader has to cope with, so the fake keeps them rather than
 * offering a tidier contract the production code would never meet.
 */
function installFakeSpeech() {
  const spoken: FakeUtterance[] = []
  let queue: FakeUtterance[] = []
  const synthesis = {
    speak: vi.fn((utterance: FakeUtterance) => {
      spoken.push(utterance)
      queue.push(utterance)
    }),
    cancel: vi.fn(() => {
      queue = []
    }),
  }
  vi.stubGlobal("speechSynthesis", synthesis)
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      text: string
      lang = ""
      rate = 1
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    },
  )
  return {
    spoken,
    synthesis,
    /** Let the utterance the browser is currently holding run to completion. */
    finishCurrent() {
      const current = queue.shift()
      current?.onend?.()
    },
    failCurrent() {
      const current = queue.shift()
      current?.onerror?.()
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("speechSupported", () => {
  it("says no when the browser has no voice", () => {
    // Every control the page offers has to be hideable, because a button that
    // does nothing is worse than an absent one.
    vi.stubGlobal("speechSynthesis", undefined)
    vi.stubGlobal("SpeechSynthesisUtterance", undefined)

    expect(speechSupported()).toBe(false)
  })

  it("says yes when both halves are there", () => {
    installFakeSpeech()

    expect(speechSupported()).toBe(true)
  })
})

describe("createSpeechReader", () => {
  let fake: ReturnType<typeof installFakeSpeech>

  beforeEach(() => {
    fake = installFakeSpeech()
  })

  it("reads the lines in order, one at a time", () => {
    // One utterance per line, not one for the whole section. A single blob
    // cannot be stopped part-way and tells the page nothing about where the
    // voice has got to, which is the thing that keeps you from losing the line.
    const reader = createSpeechReader()

    reader.start(["第一句。", "第二句。", "第三句。"])

    expect(fake.spoken).toHaveLength(1)
    expect(fake.spoken[0].text).toBe("第一句。")
    fake.finishCurrent()
    expect(fake.spoken[1].text).toBe("第二句。")
  })

  it("reports which line it is on, so the page can mark it", () => {
    const seen: number[] = []
    const reader = createSpeechReader({ onLine: (index) => seen.push(index) })

    reader.start(["一", "二"])
    fake.finishCurrent()

    expect(seen).toEqual([0, 1])
  })

  it("says it has finished once the last line is done", () => {
    const reader = createSpeechReader()
    reader.start(["只有一句"])
    expect(reader.speaking()).toBe(true)

    fake.finishCurrent()

    expect(reader.speaking()).toBe(false)
  })

  it("stops where it is when asked", () => {
    // A voice you cannot interrupt is worse than no voice: reading is slow, and
    // being read the wrong section to the end is the exact failure this page is
    // supposed to prevent.
    const reader = createSpeechReader()
    reader.start(["一", "二", "三"])

    reader.stop()

    expect(fake.synthesis.cancel).toHaveBeenCalled()
    expect(reader.speaking()).toBe(false)
  })

  it("does not keep reading the old section after being stopped", () => {
    // cancel() drops the queue without firing onend, but a callback already in
    // flight can still arrive. If that advanced the cursor, turning the page
    // would leave the previous section reading itself out underneath the new one.
    const reader = createSpeechReader()
    reader.start(["一", "二", "三"])
    const stale = fake.spoken[0]

    reader.stop()
    stale.onend?.()

    expect(fake.spoken).toHaveLength(1)
    expect(reader.speaking()).toBe(false)
  })

  it("starts the new section from its first line, not where the last one stopped", () => {
    const reader = createSpeechReader()
    reader.start(["旧一", "旧二"])
    fake.finishCurrent()

    reader.start(["新一", "新二"])

    expect(fake.synthesis.cancel).toHaveBeenCalled()
    expect(fake.spoken.at(-1)?.text).toBe("新一")
  })

  it("carries the language and pace onto every line", () => {
    // Pace is the whole point of reading along rather than listening: the
    // default rate is tuned for people who read at speed.
    const reader = createSpeechReader({ locale: "zh-CN", rate: 0.8 })

    reader.start(["一", "二"])
    fake.finishCurrent()

    expect(fake.spoken.map((utterance) => utterance.lang)).toEqual(["zh-CN", "zh-CN"])
    expect(fake.spoken.map((utterance) => utterance.rate)).toEqual([0.8, 0.8])
  })

  it("skips blank lines rather than pausing on them", () => {
    const reader = createSpeechReader()

    reader.start(["  ", "有内容"])

    expect(fake.spoken).toHaveLength(1)
    expect(fake.spoken[0].text).toBe("有内容")
  })

  it("stays silent, and says so, when there is nothing to read", () => {
    const reader = createSpeechReader()

    expect(reader.start(["", "   "])).toBe(false)
    expect(fake.spoken).toHaveLength(0)
    expect(reader.speaking()).toBe(false)
  })

  it("gives up on the section when a line fails rather than hanging on it", () => {
    // onerror instead of onend leaves the reader waiting forever for a line
    // that will never end, and the button stuck saying 停止朗读.
    const reader = createSpeechReader()
    reader.start(["一", "二"])

    fake.failCurrent()

    expect(reader.speaking()).toBe(false)
  })

  it("refuses to start when the browser has no voice", () => {
    vi.stubGlobal("speechSynthesis", undefined)
    const reader = createSpeechReader()

    expect(reader.start(["一"])).toBe(false)
    expect(reader.speaking()).toBe(false)
  })
})
