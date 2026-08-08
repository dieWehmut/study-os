import { resolveApiBase } from "./client"

export type PronunciationSource = "file" | "browser" | "unavailable"

// The generating route rejects requests without this header, so a missing one
// is a silent 403 rather than a synthesized word.
const generationHeader = "X-Study-OS-Request"

function audioURL(term: string, locale: string, format: string): string {
  const query = new URLSearchParams({ term, locale, format })
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

export async function playPronunciation(
  term: string,
  options: { locale?: string; format?: string } = {},
): Promise<PronunciationSource> {
  const normalizedTerm = term.trim()
  if (!normalizedTerm) return "unavailable"

  const locale = options.locale ?? "en-US"
  const format = options.format ?? "wav"
  const url = audioURL(normalizedTerm, locale, format)

  // Cached or local audio first -- it is free and instant.
  if (await play(url)) return "file"
  // Then the server's generator, which is where the cloud voice lives.
  if (await synthesize(url)) return "file"
  // Then the browser's own voice, so the learner still hears the word.
  if (speak(normalizedTerm, locale)) return "browser"
  return "unavailable"
}
