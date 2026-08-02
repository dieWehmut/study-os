import { resolveApiBase } from "./client"

export type PronunciationSource = "file" | "browser" | "unavailable"

function audioURL(term: string, locale: string, format: string): string {
  const query = new URLSearchParams({ term, locale, format })
  return `${resolveApiBase()}/audio?${query.toString()}`
}

export async function playPronunciation(
  term: string,
  options: { locale?: string; format?: string } = {},
): Promise<PronunciationSource> {
  const normalizedTerm = term.trim()
  if (!normalizedTerm) return "unavailable"

  const locale = options.locale ?? "en-US"
  const format = options.format ?? "wav"
  try {
    const AudioConstructor = typeof window !== "undefined" ? window.Audio : undefined
    if (typeof AudioConstructor !== "function") throw new Error("audio playback is unavailable")
    const player = new AudioConstructor(audioURL(normalizedTerm, locale, format))
    await player.play()
    return "file"
  } catch {
    if (typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(normalizedTerm)
      utterance.lang = locale
      window.speechSynthesis.speak(utterance)
      return "browser"
    }
    return "unavailable"
  }
}
