/** How a section is read out loud. */
export interface SpeechReaderOptions {
  locale?: string
  /**
   * Slower than the browser default on purpose: the point of reading along is
   * to keep pace with your eyes, not to get through the section quickly.
   */
  rate?: number
  /** Which line the voice has reached, so the page can mark it. */
  onLine?: (index: number) => void
  /** The section ran out, or was given up on. */
  onDone?: () => void
}

export interface SpeechReader {
  /** Read these lines in order. False when there was nothing to say. */
  start: (lines: readonly string[]) => boolean
  stop: () => void
  speaking: () => boolean
}

export function speechSupported(): boolean {
  return (
    typeof speechSynthesis !== "undefined" &&
    Boolean(speechSynthesis) &&
    typeof SpeechSynthesisUtterance === "function"
  )
}

/**
 * Reads a section out loud, one line at a time.
 *
 * One utterance per line rather than one for the whole section, for two
 * reasons that both come back to not losing your place: the voice can be
 * stopped between lines instead of only at the end, and the page can be told
 * which line is being spoken so it can mark it.
 *
 * Every callback is guarded by a run counter. The browser's speech object is a
 * process-wide singleton whose cancel() drops the queue *without* firing the
 * pending onend, but a callback already in flight still arrives -- and an
 * ungated one would advance the cursor of a section you have already left,
 * leaving the previous section reading itself out under the new one.
 */
export function createSpeechReader(options: SpeechReaderOptions = {}): SpeechReader {
  const { locale = "zh-CN", rate = 0.95, onLine, onDone } = options

  let lines: string[] = []
  // Where each spoken line sat in the array the caller handed over. Blanks are
  // dropped from the queue but must not shift the reported position, or the
  // page would mark the wrong line from the first blank onwards.
  let origins: number[] = []
  let cursor = 0
  let active = false
  // Bumped by every start and stop. A callback carrying an older number
  // belongs to a section that is no longer on screen, and is dropped.
  let run = 0

  function finish() {
    active = false
    lines = []
    origins = []
    cursor = 0
    onDone?.()
  }

  function speakCurrent(token: number) {
    if (token !== run || cursor >= lines.length) {
      if (token === run) finish()
      return
    }
    const utterance = new SpeechSynthesisUtterance(lines[cursor])
    utterance.lang = locale
    utterance.rate = rate
    onLine?.(origins[cursor])
    utterance.onend = () => {
      if (token !== run) return
      cursor += 1
      speakCurrent(token)
    }
    // A line that fails never ends, so without this the reader waits on it
    // forever and the button stays stuck saying 停止朗读.
    utterance.onerror = () => {
      if (token !== run) return
      finish()
    }
    speechSynthesis.speak(utterance)
  }

  return {
    start(nextLines) {
      if (!speechSupported()) return false
      // Blank lines come from the chunker's spacing, not from the document;
      // reading them would just be dead air with the cursor sitting still.
      const spoken: string[] = []
      const spokenOrigins: number[] = []
      nextLines.forEach((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) return
        spoken.push(trimmed)
        spokenOrigins.push(index)
      })
      run += 1
      speechSynthesis.cancel()
      if (spoken.length === 0) {
        active = false
        lines = []
        origins = []
        cursor = 0
        return false
      }
      lines = spoken
      origins = spokenOrigins
      cursor = 0
      active = true
      speakCurrent(run)
      return true
    },
    stop() {
      run += 1
      active = false
      lines = []
      origins = []
      cursor = 0
      if (speechSupported()) speechSynthesis.cancel()
    },
    speaking: () => active,
  }
}
