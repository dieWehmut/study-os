import { useCallback, useEffect, useRef, useState } from "react"

import { synthesizeSentence } from "@/api/audio"
import { splitSentences } from "@/lib/sentences"

export type PassageSpeechStatus = "idle" | "preparing" | "playing" | "error"

export interface PassageSpeechOptions {
  roleId?: string
}

export interface PassageSpeech {
  status: PassageSpeechStatus
  /** Which piece is being read, zero-based. Meaningless unless playing. */
  currentIndex: number
  /** Pieces in the passage being read, so a caller can show N of M. */
  total: number
  error: string | null
  start: (text: string, options?: PassageSpeechOptions) => void
  stop: () => void
  toggle: (text: string, options?: PassageSpeechOptions) => void
}

function createAudio(source: string): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof window.Audio !== "function") return null
  return new window.Audio(source)
}

/**
 * Reads a passage aloud piece by piece, playing one while the next is still
 * being made.
 *
 * 本地引擎大致按实时速度合成，两百秒的正文要等三分钟才出得来。整段一次要完，
 * 用户就得对着转圈等到那时候；逐句要、边放边取，等待就只剩第一句的长度。
 */
export function usePassageSpeech(): PassageSpeech {
  const [status, setStatus] = useState<PassageSpeechStatus>("idle")
  const [currentIndex, setCurrentIndex] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Every async step remembers which run it belongs to. Bytes that arrive after
  // the reader pressed stop belong to a dead run and must not start playing.
  const runRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlsRef = useRef(new Set<string>())

  const release = useCallback((url: string) => {
    // Only revoke what is still ours: a URL torn down twice would be a lie
    // about what is outstanding.
    if (!urlsRef.current.delete(url)) return
    URL.revokeObjectURL(url)
  }, [])

  // Silences everything without touching the visible state, so start() can use
  // it without flashing idle on its way to preparing.
  const teardown = useCallback(() => {
    runRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    const audio = audioRef.current
    if (audio) {
      // Cleared first: pausing can still fire, and a handler from a dead run
      // would queue the next sentence right after we stopped.
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audioRef.current = null
    }
    // Pausing alone leaks the blob for the page's lifetime, and a passage is
    // dozens of them.
    for (const url of urlsRef.current) URL.revokeObjectURL(url)
    urlsRef.current.clear()
  }, [])

  const stop = useCallback(() => {
    teardown()
    setStatus("idle")
    setCurrentIndex(0)
    setTotal(0)
    setError(null)
  }, [teardown])

  const start = useCallback(
    (text: string, options: PassageSpeechOptions = {}) => {
      // Starting again while a passage is in the air stops it first; two voices
      // at once is never what was asked for.
      teardown()
      const sentences = splitSentences(text)
      if (sentences.length === 0) {
        setStatus("idle")
        setCurrentIndex(0)
        setTotal(0)
        setError(null)
        return
      }

      const run = runRef.current
      const controller = new AbortController()
      controllerRef.current = controller
      const alive = () => runRef.current === run && !controller.signal.aborted

      setError(null)
      setTotal(sentences.length)
      setCurrentIndex(0)
      setStatus("preparing")

      const pending = new Map<number, Promise<Blob>>()

      const request = (index: number) => {
        if (index >= sentences.length || pending.has(index)) return
        const bytes = synthesizeSentence(sentences[index], {
          roleId: options.roleId,
          signal: controller.signal,
        })
        // A prefetch nobody gets to await still rejects when stop() aborts it.
        // This marks it handled without taking the failure from the awaiter.
        bytes.catch(() => {})
        pending.set(index, bytes)
      }

      const fail = (cause: unknown) => {
        if (!alive()) return
        teardown()
        setStatus("error")
        // 一句失败就停下并说出来。跳过去接着读，等于假装整段都念完了。
        setError(cause instanceof Error ? cause.message : "朗读失败")
      }

      const play = async (index: number) => {
        if (!alive()) return
        if (index >= sentences.length) {
          stop()
          return
        }
        request(index)
        // Depth two, deliberately. The local engine holds one instance and
        // serialises requests, so a longer queue overlaps nothing and only
        // spends synthesis time on text the reader may never reach.
        request(index + 1)

        const inflight = pending.get(index)
        if (!inflight) return
        pending.delete(index)

        let bytes: Blob
        try {
          bytes = await inflight
        } catch (cause) {
          fail(cause)
          return
        }
        // The await is where a stop can land, so ask again before playing.
        if (!alive()) return

        const url = URL.createObjectURL(bytes)
        urlsRef.current.add(url)
        const audio = createAudio(url)
        if (!audio) {
          release(url)
          fail(new Error("当前环境无法播放音频"))
          return
        }
        audioRef.current = audio
        audio.onended = () => {
          release(url)
          void play(index + 1)
        }
        audio.onerror = () => {
          release(url)
          fail(new Error("音频播放失败"))
        }
        setCurrentIndex(index)
        try {
          await audio.play()
        } catch (cause) {
          fail(cause)
          return
        }
        if (!alive()) return
        // Stays "playing" through the gaps between pieces: the reader is in the
        // middle of a passage, and a spinner returning at every sentence would
        // read as something having gone wrong.
        setStatus("playing")
      }

      void play(0)
    },
    [release, stop, teardown],
  )

  const toggle = useCallback(
    (text: string, options?: PassageSpeechOptions) => {
      // 同一颗按钮既是开始也是停止：正在读的时候再按一次就是停。
      //
      // Checked against the ref, not the `status` state: `status` is only
      // current as of the last render, so two toggle() calls in the same tick
      // -- before React has re-rendered between them -- both saw the same
      // stale "idle" and both called start(), turning "start then stop" into
      // "start then start over". controllerRef is set the instant start()
      // begins and cleared the instant a run ends, so it is never stale.
      if (controllerRef.current) {
        stop()
        return
      }
      start(text, options)
    },
    [start, stop],
  )

  // Leaving the page must take the voice with it.
  useEffect(() => stop, [stop])

  return { status, currentIndex, total, error, start, stop, toggle }
}
