import { resolveApiBase } from "./client"
import { isStaticDemo } from "@/lib/runtime"

export type PronunciationSource = "file" | "browser" | "unavailable"

// The generating route rejects requests without this header, so a missing one
// is a silent 403 rather than a synthesized word.
const generationHeader = "X-Study-OS-Request"

// format 省略时不写进 query，交给后端用设置里选的容器。硬写 "wav" 会让 音频格式
// 那个选择器怎么选都一样。
function audioURL(term: string, locale: string, format?: string): string {
  const query = new URLSearchParams({ term, locale })
  if (format) query.set("format", format)
  return `${resolveApiBase()}/audio?${query.toString()}`
}

function resolveAudioConstructor(): typeof Audio | undefined {
  return typeof window !== "undefined" && typeof window.Audio === "function" ? window.Audio : undefined
}

async function play(source: string): Promise<boolean> {
  const AudioConstructor = resolveAudioConstructor()
  if (!AudioConstructor) return false
  try {
    await new AudioConstructor(source).play()
    return true
  } catch {
    return false
  }
}

// synthesize asks the server to generate the clip. A plain GET only ever serves
// what is already cached, so without this step the cloud voice and its timeline
// are unreachable and every press lands on the browser's robotic fallback.
async function synthesize(url: string): Promise<boolean> {
  if (typeof fetch !== "function") return false
  let objectURL: string | undefined
  try {
    const response = await fetch(url, { method: "POST", headers: { [generationHeader]: "1" } })
    if (!response.ok) return false
    objectURL = URL.createObjectURL(await response.blob())
    return await play(objectURL)
  } catch {
    return false
  } finally {
    // Revoking immediately is safe: play() has already handed the bytes to the
    // element, and holding the URL would leak the blob for the page's lifetime.
    if (objectURL) URL.revokeObjectURL(objectURL)
  }
}

function speak(term: string, locale: string): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false
  if (typeof SpeechSynthesisUtterance === "undefined") return false
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(term)
  utterance.lang = locale
  window.speechSynthesis.speak(utterance)
  return true
}

/**
 * One piece of a passage, as bytes. Playback and revokeObjectURL are the
 * caller's, because a passage is read piece by piece and only the caller knows
 * when the last one has finished.
 *
 * The signal matters more here than for a single word: the local engine
 * synthesizes at about real time, so a reader who moves on would otherwise
 * leave minutes of work queued for text nobody will hear.
 */
export async function synthesizeSentence(
  text: string,
  options: { roleId?: string; format?: string; signal?: AbortSignal } = {},
): Promise<Blob> {
  if (isStaticDemo()) throw new Error("Static demo audio is provided by browser speech")

  const query = new URLSearchParams({ term: text })
  if (options.roleId) query.set("role", options.roleId)
  if (options.format) query.set("format", options.format)

  const response = await fetch(`${resolveApiBase()}/audio?${query.toString()}`, {
    method: "POST",
    headers: { [generationHeader]: "1" },
    signal: options.signal,
  })
  if (!response.ok) {
    // 后端失败时回的是 {"error": "..."}，读得到就用它，读不到再退回状态码。
    let message = `朗读失败（HTTP ${response.status}）`
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload?.error) message = payload.error
    } catch {
      // 响应体不是 JSON，保留上面的兜底文案。
    }
    throw new Error(message)
  }
  return response.blob()
}

export async function playPronunciation(
  term: string,
  options: { locale?: string; format?: string } = {},
): Promise<PronunciationSource> {
  const normalizedTerm = term.trim()
  if (!normalizedTerm) return "unavailable"

  const locale = options.locale ?? "en-US"
  if (isStaticDemo()) return speak(normalizedTerm, locale) ? "browser" : "unavailable"
  const url = audioURL(normalizedTerm, locale, options.format)

  // Cached or local audio first -- it is free and instant.
  if (await play(url)) return "file"
  // Then the server's generator, which is where the cloud voice lives.
  if (await synthesize(url)) return "file"
  // Then the browser's own voice, so the learner still hears the word.
  if (speak(normalizedTerm, locale)) return "browser"
  return "unavailable"
}
