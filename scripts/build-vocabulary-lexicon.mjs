import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { extractEntries, serializeLexicon } from "./vocabulary-lexicon.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const defaultPaths = Object.freeze({
  single: "prompt/00-MOC.md",
  expressions: "prompt/00-MOC (1).md",
  article: "prompt/O01-1 \u5377\u4e00 \u7537\u5b69\u4e0e\u5973\u795e \u2460.md",
  out: "frontend/src/generated/vocabulary-lexicon.ts",
})

function resolveInputPath(value, fallback) {
  const selected = value ?? fallback
  return path.isAbsolute(selected) ? selected : path.resolve(repositoryRoot, selected)
}

function readSource(filePath) {
  return fs.readFileSync(filePath, "utf8")
}

/**
 * Build the tracked lexicon from the local, intentionally ignored sources.
 * The article is parsed as a safety fixture; its navigation links are not
 * vocabulary entries and therefore do not add terms to the output.
 *
 * @param {{ single?: string, expressions?: string, article?: string, out?: string }} [options]
 * @returns {{ outputPath: string, entryCount: number, sourcePaths: string[] }}
 */
export function buildVocabularyLexicon(options = {}) {
  const singlePath = resolveInputPath(options.single, defaultPaths.single)
  const expressionsPath = resolveInputPath(options.expressions, defaultPaths.expressions)
  const articlePath = resolveInputPath(options.article, defaultPaths.article)
  const outputPath = resolveInputPath(options.out, defaultPaths.out)

  const wordEntries = extractEntries(readSource(singlePath), "word", {
    sourceName: singlePath,
    strict: true,
  })
  const expressionEntries = extractEntries(readSource(expressionsPath), "expression", {
    sourceName: expressionsPath,
    strict: true,
  })

  // Keep the third fixture in the generation contract. It is intentionally
  // filtered by the parser because the article only has navigation links.
  const article = readSource(articlePath)
  const articleEntries = [
    ...extractEntries(article, "word", { sourceName: articlePath, strict: true }),
    ...extractEntries(article, "expression", { sourceName: articlePath, strict: true }),
  ]

  const serialized = serializeLexicon([...wordEntries, ...expressionEntries, ...articleEntries])
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, serialized, "utf8")

  return {
    outputPath,
    entryCount: (serialized.match(/\n  \{ /gu) ?? []).length,
    sourcePaths: [singlePath, expressionsPath, articlePath],
  }
}

function parseArguments(argumentsList) {
  const options = {}
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (!argument.startsWith("--")) continue
    const equals = argument.indexOf("=")
    if (equals >= 0) {
      options[argument.slice(2, equals)] = argument.slice(equals + 1)
      continue
    }
    const key = argument.slice(2)
    const next = argumentsList[index + 1]
    if (next && !next.startsWith("--")) {
      options[key] = next
      index += 1
    } else {
      options[key] = "true"
    }
  }
  return options
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isCli) {
  try {
    const args = parseArguments(process.argv.slice(2))
    const result = buildVocabularyLexicon({
      single: args.single,
      expressions: args.expressions,
      article: args.article,
      out: args.out,
    })
    process.stdout.write(`wrote ${result.entryCount} entries to ${path.relative(repositoryRoot, result.outputPath)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`vocabulary lexicon build failed: ${message}\n`)
    process.exitCode = 1
  }
}
