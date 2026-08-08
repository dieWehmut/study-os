import type { ReadingChunk } from "./chunk"

/**
 * Turn a section that landed into something the knowledge library can file.
 *
 * The place goes first because the store names an item after the first 40
 * characters of whatever it is handed. Led by the prose, a preview pass fills
 * the library with entries called "在类囊体薄膜上进行。" -- sentences wearing a
 * title's clothes, unfindable a week later. Led by the heading path, each
 * entry arrives under the name the document already gave it.
 *
 * The words come along for the same reason they do on the way to 答疑: a
 * heading with nothing under it is a title for something you can no longer
 * read, which is worth less than not keeping it.
 */
export function buildSectionNote(chunk: ReadingChunk): string {
  return [chunk.path.join(" / "), ...chunk.lines].join("\n")
}
